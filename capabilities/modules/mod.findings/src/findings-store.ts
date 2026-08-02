import {
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  FINDING_TYPES,
  type CreateFindingInput,
  type EditFindingInput,
  type EvidenceAttachment,
  type Finding,
  type FindingFilter,
  type FindingHistory,
  type FindingStatus,
  type FindingVerification,
  type FindingsClock,
  type FindingsIdentifierSource,
  type FindingsManagementOptions,
  type FindingsSnapshot,
  type SourceLocation,
} from "./contracts.ts";

const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};
const optional = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  Open: ["Addressed", "Rejected", "Deferred"],
  Addressed: ["Open", "Verified", "Rejected", "Deferred"],
  Verified: ["Open", "Deferred"],
  Rejected: ["Open", "Deferred"],
  Deferred: ["Open", "Addressed", "Rejected"],
};

class SystemClock implements FindingsClock {
  public now(): string { return new Date().toISOString(); }
}

class LocalIdentifiers implements FindingsIdentifierSource {
  private sequence = 0;
  public next(kind: "finding" | "history" | "verification"): string {
    this.sequence += 1;
    return kind === "finding" ? `FND-${Date.now()}-${this.sequence}` : `${kind}-${Date.now()}-${this.sequence}`;
  }
}

function validateSource(source: SourceLocation): SourceLocation {
  required(source.projectId, "Source project ID");
  required(source.revisionId, "Source revision ID");
  required(source.artifactId, "Source artifact ID");
  required(source.sliceId, "Source slice ID");
  required(source.path, "Source path");
  required(source.location, "Source location");
  required(source.title, "Source title");
  return copy(source);
}

function validateEvidence(evidence: EvidenceAttachment): EvidenceAttachment {
  required(evidence.id, "Evidence ID");
  required(evidence.name, "Evidence name");
  required(evidence.path, "Evidence path");
  required(evidence.mediaType, "Evidence media type");
  required(evidence.contentHash, "Evidence content hash");
  if (!Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes < 0) throw new Error("Evidence size must be a non-negative integer.");
  required(evidence.addedAt, "Evidence date");
  return copy(evidence);
}

function canonicalSnapshot(snapshot: FindingsSnapshot): FindingsSnapshot {
  return {
    schemaVersion: "1.0",
    generation: snapshot.generation,
    findings: [...snapshot.findings]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((finding) => ({
        ...copy(finding),
        evidenceAttachments: [...finding.evidenceAttachments].sort((left, right) => left.id.localeCompare(right.id)).map(copy),
        verifications: [...finding.verifications].sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt) || left.id.localeCompare(right.id)).map(copy),
        history: [...finding.history].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id)).map(copy),
      })),
  };
}

export class FindingsManagement {
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private state: FindingsSnapshot,
    private readonly options: Required<Pick<FindingsManagementOptions, "persistence" | "navigator">> & {
      clock: FindingsClock;
      identifiers: FindingsIdentifierSource;
    },
  ) {}

  public static async open(options: FindingsManagementOptions): Promise<FindingsManagement> {
    const loaded = await options.persistence.load();
    const snapshot = loaded?.schemaVersion === "1.0" && Array.isArray(loaded.findings)
      ? canonicalSnapshot(loaded)
      : { schemaVersion: "1.0" as const, generation: 0, findings: [] };
    return new FindingsManagement(snapshot, {
      persistence: options.persistence,
      navigator: options.navigator,
      clock: options.clock ?? new SystemClock(),
      identifiers: options.identifiers ?? new LocalIdentifiers(),
    });
  }

  public snapshot(): FindingsSnapshot { return copy(canonicalSnapshot(this.state)); }

  public list(filter: FindingFilter = {}): Finding[] {
    const query = optional(filter.query)?.toLowerCase();
    return this.state.findings.filter((finding) => {
      const searchable = [
        finding.id,
        finding.description,
        finding.resolution,
        finding.externalReference,
        finding.source.title,
        finding.source.path,
        finding.source.location,
      ].filter(Boolean).join(" ").toLowerCase();
      return (!query || searchable.includes(query)) &&
        (!filter.projectId || finding.source.projectId === filter.projectId) &&
        (!filter.revisionId || finding.source.revisionId === filter.revisionId) &&
        (!filter.artifactId || finding.source.artifactId === filter.artifactId) &&
        (!filter.sliceId || finding.source.sliceId === filter.sliceId) &&
        (!filter.type || finding.type === filter.type) &&
        (!filter.status || finding.status === filter.status) &&
        (!filter.severity || finding.severity === filter.severity) &&
        (!filter.createdFrom || finding.createdAt >= filter.createdFrom) &&
        (!filter.createdTo || finding.createdAt <= filter.createdTo);
    }).map(copy);
  }

  public get(id: string): Finding | undefined {
    const finding = this.state.findings.find((item) => item.id === id);
    return finding ? copy(finding) : undefined;
  }

  public allowedStatusTransitions(id: string): FindingStatus[] {
    return [...TRANSITIONS[this.requireFinding(id).status]];
  }

  public async create(input: CreateFindingInput): Promise<Finding> {
    if (!FINDING_TYPES.includes(input.type)) throw new Error(`Unknown finding type: ${input.type}`);
    if (input.severity && !FINDING_SEVERITIES.includes(input.severity)) throw new Error(`Unknown finding severity: ${input.severity}`);
    return this.mutate((findings, at) => {
      const id = optional(input.id) ?? this.options.identifiers.next("finding");
      if (findings.some((finding) => finding.id === id)) throw new Error(`Finding ${id} already exists.`);
      const relatedFindingId = optional(input.relatedFindingId);
      if (relatedFindingId && !findings.some((finding) => finding.id === relatedFindingId)) throw new Error(`Related finding ${relatedFindingId} does not exist.`);
      const finding: Finding = {
        id,
        type: input.type,
        status: "Open",
        description: required(input.description, "Description"),
        source: validateSource(input.source),
        createdAt: at,
        updatedAt: at,
        ...(input.severity ? { severity: input.severity } : {}),
        ...(optional(input.resolution) ? { resolution: input.resolution!.trim() } : {}),
        ...(optional(input.externalReference) ? { externalReference: input.externalReference!.trim() } : {}),
        ...(relatedFindingId ? { relatedFindingId } : {}),
        evidenceAttachments: (input.evidenceAttachments ?? []).map(validateEvidence),
        verifications: [],
        history: [this.history("Created", "Open", at)],
      };
      return { findings: [...findings, finding], value: finding };
    });
  }

  public async edit(id: string, input: EditFindingInput): Promise<Finding> {
    return this.mutate((findings, at) => {
      const current = this.requireFindingFrom(findings, id);
      if (input.type && !FINDING_TYPES.includes(input.type)) throw new Error(`Unknown finding type: ${input.type}`);
      if (input.severity && !FINDING_SEVERITIES.includes(input.severity)) throw new Error(`Unknown finding severity: ${input.severity}`);
      const relatedFindingId = optional(input.relatedFindingId);
      if (relatedFindingId === id) throw new Error("A finding cannot relate to itself.");
      if (relatedFindingId && !findings.some((finding) => finding.id === relatedFindingId)) throw new Error(`Related finding ${relatedFindingId} does not exist.`);
      const updated: Finding = {
        ...current,
        ...(input.type ? { type: input.type } : {}),
        ...(input.description === undefined ? {} : { description: required(input.description, "Description") }),
        ...(input.source ? { source: validateSource(input.source) } : {}),
        ...(input.severity === undefined ? {} : { severity: input.severity ?? undefined }),
        ...(input.resolution === undefined ? {} : { resolution: optional(input.resolution) }),
        ...(input.externalReference === undefined ? {} : { externalReference: optional(input.externalReference) }),
        ...(input.relatedFindingId === undefined ? {} : { relatedFindingId }),
        updatedAt: at,
        history: [...current.history, this.history("Edited", current.status, at)],
      };
      return { findings: findings.map((finding) => finding.id === id ? updated : finding), value: updated };
    });
  }

  public async transitionStatus(id: string, status: FindingStatus, note?: string): Promise<Finding> {
    if (!FINDING_STATUSES.includes(status)) throw new Error(`Unknown finding status: ${status}`);
    return this.mutate((findings, at) => {
      const current = this.requireFindingFrom(findings, id);
      if (!TRANSITIONS[current.status].includes(status)) throw new Error(`Status cannot change from ${current.status} to ${status}.`);
      if (status === "Verified") throw new Error("Use verifyAgainstRevision to record later-revision evidence.");
      const updated: Finding = {
        ...current,
        status,
        updatedAt: at,
        history: [...current.history, this.history("Status changed", status, at, optional(note), current.status)],
      };
      return { findings: findings.map((finding) => finding.id === id ? updated : finding), value: updated };
    });
  }

  public async addEvidence(id: string, evidence: EvidenceAttachment): Promise<Finding> {
    const checked = validateEvidence(evidence);
    return this.mutate((findings, at) => {
      const current = this.requireFindingFrom(findings, id);
      if (current.evidenceAttachments.some((item) => item.id === checked.id)) throw new Error(`Evidence ${checked.id} already exists on finding ${id}.`);
      const updated: Finding = {
        ...current,
        evidenceAttachments: [...current.evidenceAttachments, checked],
        updatedAt: at,
        history: [...current.history, this.history("Evidence added", current.status, at, checked.id)],
      };
      return { findings: findings.map((finding) => finding.id === id ? updated : finding), value: updated };
    });
  }

  public async verifyAgainstRevision(id: string, source: SourceLocation, note?: string): Promise<Finding> {
    const verifiedSource = validateSource(source);
    return this.mutate((findings, at) => {
      const current = this.requireFindingFrom(findings, id);
      if (current.status !== "Addressed") throw new Error("A finding must be Addressed before verification.");
      if (verifiedSource.projectId !== current.source.projectId) throw new Error("Verification must remain in the same review project.");
      if (verifiedSource.revisionId === current.source.revisionId) throw new Error("Verification requires a later artifact revision.");
      const verification: FindingVerification = {
        id: this.options.identifiers.next("verification"),
        revisionId: verifiedSource.revisionId,
        source: verifiedSource,
        verifiedAt: at,
        ...(optional(note) ? { note: note!.trim() } : {}),
      };
      const updated: Finding = {
        ...current,
        status: "Verified",
        updatedAt: at,
        verifications: [...current.verifications, verification],
        history: [...current.history, this.history("Verified", "Verified", at, optional(note), current.status)],
      };
      return { findings: findings.map((finding) => finding.id === id ? updated : finding), value: updated };
    });
  }

  public async openSource(id: string): Promise<void> {
    await this.options.navigator.openSource(copy(this.requireFinding(id).source));
  }

  /** Remove findings owned by a project after the user confirms project deletion. */
  public async deleteForProject(projectId: string): Promise<number> {
    const normalizedProjectId = required(projectId, "Project ID");
    let resolve!: (value: number) => void;
    let reject!: (reason?: unknown) => void;
    const result = new Promise<number>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    const run = async (): Promise<void> => {
      try {
        const retained = this.state.findings.filter((finding) => finding.source.projectId !== normalizedProjectId);
        const removed = this.state.findings.length - retained.length;
        if (!removed) { resolve(0); return; }
        const next = canonicalSnapshot({ schemaVersion: "1.0", generation: this.state.generation + 1, findings: retained });
        await this.options.persistence.save(copy(next));
        this.state = next;
        resolve(removed);
      } catch (error) {
        reject(error);
      }
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return result;
  }

  private async mutate(change: (findings: readonly Finding[], at: string) => { findings: readonly Finding[]; value: Finding }): Promise<Finding> {
    let resolve!: (value: Finding) => void;
    let reject!: (reason?: unknown) => void;
    const result = new Promise<Finding>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    const run = async (): Promise<void> => {
      try {
        const at = this.options.clock.now();
        const changed = change(copy(this.state.findings), at);
        const next = canonicalSnapshot({ schemaVersion: "1.0", generation: this.state.generation + 1, findings: changed.findings });
        await this.options.persistence.save(copy(next));
        this.state = next;
        resolve(copy(changed.value));
      } catch (error) {
        reject(error);
      }
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return result;
  }

  private requireFinding(id: string): Finding { return this.requireFindingFrom(this.state.findings, id); }
  private requireFindingFrom(findings: readonly Finding[], id: string): Finding {
    const finding = findings.find((item) => item.id === id);
    if (!finding) throw new Error(`Finding ${id} does not exist.`);
    return finding;
  }

  private history(action: FindingHistory["action"], status: FindingStatus, at: string, note?: string, previousStatus?: FindingStatus): FindingHistory {
    return {
      id: this.options.identifiers.next("history"),
      action,
      status,
      at,
      ...(note ? { note } : {}),
      ...(previousStatus ? { previousStatus } : {}),
    };
  }
}
