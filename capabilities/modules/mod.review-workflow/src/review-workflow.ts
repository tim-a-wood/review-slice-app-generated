import type {
  ArtifactRevision,
  ArtifactRevisionInput,
  CreateReviewProjectInput,
  DecisionInput,
  ReviewDecision,
  ReviewHistoryEntry,
  ReviewProject,
  ReviewSlice,
  ReviewSliceInput,
  ReviewState,
  ReviewWorkflowOptions,
  ReviewWorkspaceSnapshot,
  SliceFilter,
  WorkflowClock,
  WorkflowIdentifierSource,
  WorkflowRecoveryMetadata,
} from "./contracts.ts";
import { REVISION_STATES, REVIEW_STATES } from "./contracts.ts";
import { cloneWorkflowSnapshot, PersistenceCoordinator } from "./persistence.ts";

const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const text = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};
const optionalText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

class SystemClock implements WorkflowClock {
  public now(): string { return new Date().toISOString(); }
}

class LocalIdentifiers implements WorkflowIdentifierSource {
  private sequence = 0;
  public next(kind: "project" | "revision" | "decision" | "note" | "history"): string {
    this.sequence += 1;
    return `${kind}-${Date.now()}-${this.sequence}`;
  }
}

function byText(left: string, right: string): number { return left.localeCompare(right); }
function canonicalSlice(left: ReviewSlice, right: ReviewSlice): number {
  return left.sequence - right.sequence || byText(left.id, right.id);
}

function canonicalProject(project: ReviewProject): ReviewProject {
  return {
    ...project,
    revisions: [...project.revisions]
      .sort((left, right) => byText(left.importedAt, right.importedAt) || byText(left.id, right.id))
      .map((revision) => ({ ...revision, slices: [...revision.slices].sort(canonicalSlice).map(copy) })),
    decisions: [...project.decisions]
      .sort((left, right) => byText(left.createdAt, right.createdAt) || byText(left.id, right.id))
      .map(copy),
    history: [...project.history]
      .sort((left, right) => byText(left.occurredAt, right.occurredAt) || byText(left.id, right.id))
      .map(copy),
  };
}

function canonicalSnapshot(snapshot: ReviewWorkspaceSnapshot): ReviewWorkspaceSnapshot {
  return {
    schemaVersion: "1.0",
    generation: snapshot.generation,
    ...(snapshot.activeProjectId ? { activeProjectId: snapshot.activeProjectId } : {}),
    projects: [...snapshot.projects].sort((left, right) => byText(left.id, right.id)).map(canonicalProject),
  };
}

function history(
  identifiers: WorkflowIdentifierSource,
  projectId: string,
  event: ReviewHistoryEntry["event"],
  value: string,
  occurredAt: string,
  details: { revisionId?: string; sliceId?: string; previousValue?: string } = {},
): ReviewHistoryEntry {
  return {
    id: identifiers.next("history"),
    projectId,
    event,
    value,
    occurredAt,
    ...details,
  };
}

function validateSliceInput(slice: ReviewSliceInput): void {
  text(slice.id, "Slice ID");
  text(slice.stableMatchKey, "Stable match key");
  text(slice.title, "Slice title");
  text(slice.contentHash, "Slice content hash");
  text(slice.source.artifactId, "Source artifact ID");
  text(slice.source.path, "Source path");
  text(slice.source.location, "Source location");
  if (!Number.isSafeInteger(slice.sequence) || slice.sequence < 0) throw new Error("Slice sequence must be a non-negative integer.");
  if (slice.revisionState && !REVISION_STATES.includes(slice.revisionState)) throw new Error(`Unknown revision state: ${slice.revisionState}`);
  if (slice.reviewState && !REVIEW_STATES.includes(slice.reviewState)) throw new Error(`Unknown review state: ${slice.reviewState}`);
}

function latestDecision(project: ReviewProject, revisionId: string, sliceId: string): ReviewDecision | undefined {
  return [...project.decisions]
    .filter((decision) => decision.revisionId === revisionId && decision.sliceId === sliceId)
    .sort((left, right) => byText(right.updatedAt, left.updatedAt) || byText(right.id, left.id))[0];
}

function createRevision(
  input: ArtifactRevisionInput,
  previous: ArtifactRevision | undefined,
  project: ReviewProject,
  now: string,
  identifiers: WorkflowIdentifierSource,
): { revision: ArtifactRevision; inheritedDecisions: ReviewDecision[] } {
  const revisionId = optionalText(input.id) ?? identifiers.next("revision");
  text(input.label, "Revision label");
  text(input.fileName, "Revision file name");
  text(input.fileHash, "Revision file hash");
  text(input.artifactType, "Artifact type");
  text(input.parserVersion, "Parser version");
  const ids = new Set<string>();
  const matchKeys = new Set<string>();
  const previousByMatch = new Map((previous?.slices ?? []).map((slice) => [slice.stableMatchKey, slice]));
  const previousById = new Map((previous?.slices ?? []).map((slice) => [slice.id, slice]));
  const inheritedDecisions: ReviewDecision[] = [];

  const slices = [...input.slices].sort((left, right) => left.sequence - right.sequence || byText(left.id, right.id)).map((item) => {
    validateSliceInput(item);
    if (ids.has(item.id)) throw new Error(`Duplicate slice ID: ${item.id}`);
    if (matchKeys.has(item.stableMatchKey)) throw new Error(`Duplicate stable match key: ${item.stableMatchKey}`);
    ids.add(item.id);
    matchKeys.add(item.stableMatchKey);
    const prior = item.previousSliceId
      ? previousById.get(item.previousSliceId)
      : previousByMatch.get(item.stableMatchKey);
    if (item.previousSliceId && !prior) {
      throw new Error(`Previous slice ${item.previousSliceId} does not exist in the prior revision.`);
    }
    const revisionState = item.revisionState ?? (previous ? (prior ? "modified" : "added") : "added");
    const carriesReview = Boolean(prior && (revisionState === "unchanged" || revisionState === "relocated"));
    const reviewState: ReviewState = item.reviewState ?? (
      carriesReview ? prior!.reviewState : revisionState === "modified" || (revisionState === "unmatched" && previous) ? "re-review-required" : "not-reviewed"
    );
    const priorDecision = prior && previous ? latestDecision(project, previous.id, prior.id) : undefined;
    if (carriesReview && priorDecision) {
      inheritedDecisions.push({
        ...copy(priorDecision),
        id: identifiers.next("decision"),
        projectId: project.id,
        revisionId,
        sliceId: item.id,
        inheritedFromDecisionId: priorDecision.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      id: item.id,
      revisionId,
      stableMatchKey: item.stableMatchKey,
      ...(item.parentId ? { parentId: item.parentId } : {}),
      title: item.title,
      content: item.content,
      contentHash: item.contentHash,
      sequence: item.sequence,
      source: copy(item.source),
      reviewState,
      revisionState,
      ...(prior ? { previousReviewState: prior.reviewState } : {}),
      ...(prior ? { previousSliceId: prior.id } : {}),
      ...(carriesReview && prior?.skipReason ? { skipReason: prior.skipReason } : {}),
      notes: carriesReview && prior ? prior.notes.map(copy) : [],
      ...(carriesReview && prior?.reviewedAt ? { reviewedAt: prior.reviewedAt } : {}),
      createdAt: now,
      updatedAt: now,
    } satisfies ReviewSlice;
  });

  return {
    revision: {
      id: revisionId,
      label: input.label.trim(),
      fileName: input.fileName.trim(),
      fileHash: input.fileHash.trim(),
      artifactType: input.artifactType.trim(),
      parserVersion: input.parserVersion.trim(),
      importedAt: input.importedAt ?? now,
      slices,
    },
    inheritedDecisions,
  };
}

export class ReviewWorkflow {
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private state: ReviewWorkspaceSnapshot,
    private readonly recovery: WorkflowRecoveryMetadata,
    private readonly persistence: PersistenceCoordinator,
    private readonly clock: WorkflowClock,
    private readonly identifiers: WorkflowIdentifierSource,
  ) {}

  public static async open(options: ReviewWorkflowOptions): Promise<ReviewWorkflow> {
    const clock = options.clock ?? new SystemClock();
    const persistence = new PersistenceCoordinator(options.persistence);
    const loaded = await persistence.load(clock.now());
    return new ReviewWorkflow(canonicalSnapshot(loaded.snapshot), loaded.recovery, persistence, clock, options.identifiers ?? new LocalIdentifiers());
  }

  public snapshot(): ReviewWorkspaceSnapshot { return cloneWorkflowSnapshot(canonicalSnapshot(this.state)); }
  public recoveryMetadata(): WorkflowRecoveryMetadata { return copy(this.recovery); }

  public listProjects(options: { includeArchived?: boolean } = {}): ReviewProject[] {
    return this.state.projects
      .filter((project) => options.includeArchived || !project.archived)
      .sort((left, right) => byText(right.lastOpenedAt, left.lastOpenedAt) || byText(left.name, right.name))
      .map((project) => copy(canonicalProject(project)));
  }

  public getProject(projectId: string): ReviewProject | undefined {
    const project = this.state.projects.find((item) => item.id === projectId);
    return project ? copy(canonicalProject(project)) : undefined;
  }

  public activeProject(): ReviewProject | undefined {
    return this.state.activeProjectId ? this.getProject(this.state.activeProjectId) : undefined;
  }

  public activeSlice(projectId: string): ReviewSlice | undefined {
    const project = this.requireProject(projectId);
    const revision = this.activeRevision(project);
    const slice = revision?.slices.find((item) => item.id === project.activeSliceId);
    return slice ? copy(slice) : undefined;
  }

  public async createProject(input: CreateReviewProjectInput): Promise<ReviewProject> {
    return this.mutate((current, now) => {
      const id = optionalText(input.id) ?? this.identifiers.next("project");
      if (current.projects.some((project) => project.id === id)) throw new Error(`Project ${id} already exists.`);
      const name = text(input.name, "Project name");
      let project: ReviewProject = {
        id,
        name,
        ...(optionalText(input.description) ? { description: input.description!.trim() } : {}),
        archived: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        revisions: [],
        decisions: [],
        history: [history(this.identifiers, id, "project-created", name, now)],
      };
      if (input.initialRevision) {
        const created = createRevision(input.initialRevision, undefined, project, now, this.identifiers);
        project = {
          ...project,
          activeRevisionId: created.revision.id,
          activeSliceId: created.revision.slices.find((slice) => slice.revisionState !== "removed")?.id,
          revisions: [created.revision],
          decisions: created.inheritedDecisions,
          history: [...project.history, history(this.identifiers, id, "revision-added", created.revision.label, now, { revisionId: created.revision.id })],
        };
      }
      const next = { ...current, activeProjectId: id, projects: [...current.projects, project] };
      return { next, value: project };
    });
  }

  public async renameProject(projectId: string, name: string): Promise<ReviewProject> {
    const normalized = text(name, "Project name");
    return this.updateProject(projectId, (project, now) => ({
      ...project,
      name: normalized,
      updatedAt: now,
      history: [...project.history, history(this.identifiers, project.id, "project-renamed", normalized, now, { previousValue: project.name })],
    }));
  }

  public async setProjectArchived(projectId: string, archived: boolean): Promise<ReviewProject> {
    return this.updateProject(projectId, (project, now) => ({
      ...project,
      archived,
      updatedAt: now,
      history: [...project.history, history(this.identifiers, project.id, archived ? "project-archived" : "project-restored", String(archived), now)],
    }), archived ? null : projectId);
  }

  public async deleteProject(projectId: string): Promise<void> {
    await this.mutate((current) => {
      this.requireProjectFrom(current, projectId);
      return {
        next: {
          ...current,
          ...(current.activeProjectId === projectId ? { activeProjectId: undefined } : {}),
          projects: current.projects.filter((project) => project.id !== projectId),
        },
        value: undefined,
      };
    });
  }

  public async openProject(projectId: string): Promise<ReviewProject> {
    return this.updateProject(projectId, (project, now) => {
      if (project.archived) throw new Error("Restore the archived project before opening it.");
      return {
        ...project,
        lastOpenedAt: now,
        updatedAt: now,
        history: [...project.history, history(this.identifiers, project.id, "project-opened", project.id, now)],
      };
    }, projectId);
  }

  public async resumeProject(projectId: string): Promise<ReviewProject> { return this.openProject(projectId); }

  public async addRevision(projectId: string, input: ArtifactRevisionInput): Promise<ArtifactRevision> {
    return this.mutate((current, now) => {
      const project = this.requireProjectFrom(current, projectId);
      const previous = this.activeRevision(project);
      const created = createRevision(input, previous, project, now, this.identifiers);
      if (project.revisions.some((revision) => revision.id === created.revision.id)) throw new Error(`Revision ${created.revision.id} already exists.`);
      const firstQueueSlice = created.revision.slices.find((slice) =>
        slice.revisionState !== "removed" && (slice.reviewState === "not-reviewed" || slice.reviewState === "re-review-required"),
      ) ?? created.revision.slices.find((slice) => slice.revisionState !== "removed");
      const updated: ReviewProject = {
        ...project,
        activeRevisionId: created.revision.id,
        activeSliceId: firstQueueSlice?.id,
        revisions: [...project.revisions, created.revision],
        decisions: [...project.decisions, ...created.inheritedDecisions],
        updatedAt: now,
        history: [...project.history, history(this.identifiers, project.id, "revision-added", created.revision.label, now, { revisionId: created.revision.id })],
      };
      return { next: this.replaceProject(current, updated, projectId), value: created.revision };
    });
  }

  public listSlices(projectId: string, filter: SliceFilter = {}): ReviewSlice[] {
    const project = this.requireProject(projectId);
    return this.filterSlices(this.activeRevision(project)?.slices ?? [], filter).map(copy);
  }

  public async selectSlice(projectId: string, sliceId: string): Promise<ReviewSlice> {
    return this.updateProject(projectId, (project, now) => {
      const revision = this.requireActiveRevision(project);
      const slice = this.requireSlice(revision, sliceId);
      return {
        ...project,
        activeSliceId: slice.id,
        updatedAt: now,
        history: [...project.history, history(this.identifiers, project.id, "slice-selected", slice.id, now, { revisionId: revision.id, sliceId: slice.id })],
      };
    }, projectId).then((project) => copy(this.requireSlice(this.requireActiveRevision(project), sliceId)));
  }

  public async navigate(projectId: string, direction: "next" | "previous", filter: SliceFilter = {}): Promise<ReviewSlice | undefined> {
    const project = this.requireProject(projectId);
    const candidates = this.filterSlices(this.requireActiveRevision(project).slices, filter);
    if (candidates.length === 0) return undefined;
    const position = candidates.findIndex((slice) => slice.id === project.activeSliceId);
    const targetIndex = position < 0 ? (direction === "next" ? 0 : candidates.length - 1) : position + (direction === "next" ? 1 : -1);
    const target = candidates[targetIndex];
    return target ? this.selectSlice(projectId, target.id) : undefined;
  }

  public async recordDecision(projectId: string, sliceId: string, input: DecisionInput): Promise<ReviewDecision> {
    if (!REVIEW_STATES.includes(input.state)) throw new Error(`Unknown review state: ${input.state}`);
    const comment = optionalText(input.comment);
    const skipReason = optionalText(input.skipReason);
    if (input.state === "skipped" && !skipReason) throw new Error("A skipped slice needs a reason.");
    if (input.state !== "skipped" && skipReason) throw new Error("Only a skipped slice can have a skip reason.");
    return this.mutate((current, now) => {
      const project = this.requireProjectFrom(current, projectId);
      const revision = this.requireActiveRevision(project);
      const target = this.requireSlice(revision, sliceId);
      const previousDecision = latestDecision(project, revision.id, sliceId);
      const decision: ReviewDecision = previousDecision ? {
        ...previousDecision,
        state: input.state,
        ...(comment ? { comment } : { comment: undefined }),
        ...(skipReason ? { skipReason } : { skipReason: undefined }),
        updatedAt: now,
      } : {
        id: this.identifiers.next("decision"),
        projectId,
        revisionId: revision.id,
        sliceId,
        state: input.state,
        ...(comment ? { comment } : {}),
        ...(skipReason ? { skipReason } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const slices = revision.slices.map((slice) => slice.id === sliceId ? {
        ...slice,
        reviewState: input.state,
        ...(skipReason ? { skipReason } : { skipReason: undefined }),
        reviewedAt: input.state === "not-reviewed" ? undefined : now,
        updatedAt: now,
      } : slice);
      const revisions = project.revisions.map((item) => item.id === revision.id ? { ...item, slices } : item);
      const decisions = previousDecision
        ? project.decisions.map((item) => item.id === previousDecision.id ? decision : item)
        : [...project.decisions, decision];
      const updated: ReviewProject = {
        ...project,
        activeSliceId: sliceId,
        revisions,
        decisions,
        updatedAt: now,
        history: [...project.history, history(this.identifiers, project.id, "decision-recorded", input.state, now, {
          revisionId: revision.id,
          sliceId,
          previousValue: target.reviewState,
        })],
      };
      return { next: this.replaceProject(current, updated, projectId), value: decision };
    });
  }

  public async decide(projectId: string, sliceId: string, state: Exclude<ReviewState, "skipped">, comment?: string): Promise<ReviewDecision> {
    return this.recordDecision(projectId, sliceId, { state, ...(comment ? { comment } : {}) });
  }

  public async skip(projectId: string, sliceId: string, reason: string, comment?: string): Promise<ReviewDecision> {
    return this.recordDecision(projectId, sliceId, { state: "skipped", skipReason: reason, ...(comment ? { comment } : {}) });
  }

  public async addNote(projectId: string, sliceId: string, note: string): Promise<ReviewSlice> {
    const value = text(note, "Note");
    return this.mutate((current, now) => {
      const project = this.requireProjectFrom(current, projectId);
      const revision = this.requireActiveRevision(project);
      const target = this.requireSlice(revision, sliceId);
      const nextNote = { id: this.identifiers.next("note"), text: value, createdAt: now };
      const updatedSlice: ReviewSlice = { ...target, notes: [...target.notes, nextNote], updatedAt: now };
      const revisions = project.revisions.map((item) => item.id === revision.id
        ? { ...item, slices: item.slices.map((slice) => slice.id === sliceId ? updatedSlice : slice) }
        : item);
      const updated: ReviewProject = {
        ...project,
        revisions,
        updatedAt: now,
        history: [...project.history, history(this.identifiers, project.id, "note-added", value, now, { revisionId: revision.id, sliceId })],
      };
      return { next: this.replaceProject(current, updated, projectId), value: updatedSlice };
    });
  }

  public progress(projectId: string): { total: number; reviewed: number; remaining: number; completionPercent: number } {
    const slices = this.listSlices(projectId, { includeRemoved: false });
    const reviewed = slices.filter((slice) => slice.reviewState !== "not-reviewed" && slice.reviewState !== "re-review-required").length;
    return {
      total: slices.length,
      reviewed,
      remaining: slices.length - reviewed,
      completionPercent: slices.length === 0 ? 0 : Math.round((reviewed / slices.length) * 10000) / 100,
    };
  }

  private async mutate<T>(change: (current: ReviewWorkspaceSnapshot, now: string) => { next: ReviewWorkspaceSnapshot; value: T }): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const result = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    const run = async (): Promise<void> => {
      const before = this.state;
      try {
        const now = this.clock.now();
        const changed = change(cloneWorkflowSnapshot(before), now);
        const next = canonicalSnapshot({ ...changed.next, generation: before.generation + 1 });
        await this.persistence.save(next, now);
        this.state = next;
        resolve(copy(changed.value));
      } catch (error) {
        reject(error);
      }
    };
    this.mutationQueue = this.mutationQueue.then(run, run);
    return result;
  }

  private async updateProject(
    projectId: string,
    change: (project: ReviewProject, now: string) => ReviewProject,
    activeProjectId?: string | null,
  ): Promise<ReviewProject> {
    return this.mutate((current, now) => {
      const updated = change(this.requireProjectFrom(current, projectId), now);
      return { next: this.replaceProject(current, updated, activeProjectId), value: updated };
    });
  }

  private replaceProject(current: ReviewWorkspaceSnapshot, project: ReviewProject, activeProjectId?: string | null): ReviewWorkspaceSnapshot {
    return {
      ...current,
      ...(activeProjectId === null
        ? { activeProjectId: undefined }
        : activeProjectId
          ? { activeProjectId }
          : {}),
      projects: current.projects.map((item) => item.id === project.id ? project : item),
    };
  }

  private requireProject(projectId: string): ReviewProject { return this.requireProjectFrom(this.state, projectId); }
  private requireProjectFrom(snapshot: ReviewWorkspaceSnapshot, projectId: string): ReviewProject {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`Project ${projectId} does not exist.`);
    return project;
  }

  private activeRevision(project: ReviewProject): ArtifactRevision | undefined {
    return project.revisions.find((revision) => revision.id === project.activeRevisionId);
  }

  private requireActiveRevision(project: ReviewProject): ArtifactRevision {
    const revision = this.activeRevision(project);
    if (!revision) throw new Error(`Project ${project.id} has no active revision.`);
    return revision;
  }

  private requireSlice(revision: ArtifactRevision, sliceId: string): ReviewSlice {
    const slice = revision.slices.find((item) => item.id === sliceId);
    if (!slice) throw new Error(`Slice ${sliceId} does not exist in revision ${revision.id}.`);
    return slice;
  }

  private filterSlices(slices: readonly ReviewSlice[], filter: SliceFilter): ReviewSlice[] {
    const query = optionalText(filter.query)?.toLowerCase();
    return [...slices].sort(canonicalSlice).filter((slice) =>
      (filter.includeRemoved || slice.revisionState !== "removed") &&
      (!filter.reviewStates?.length || filter.reviewStates.includes(slice.reviewState)) &&
      (!filter.revisionStates?.length || filter.revisionStates.includes(slice.revisionState)) &&
      (filter.hasNotes === undefined || (slice.notes.length > 0) === filter.hasNotes) &&
      (!query || `${slice.title} ${slice.source.path} ${slice.source.location} ${slice.content}`.toLowerCase().includes(query)),
    );
  }
}

export async function createReviewWorkflow(options: ReviewWorkflowOptions): Promise<ReviewWorkflow> {
  return ReviewWorkflow.open(options);
}
