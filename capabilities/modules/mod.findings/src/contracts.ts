export const FINDING_TYPES = [
  "Defect",
  "Question",
  "Improvement",
  "Inconsistency",
  "Missing information",
  "Traceability issue",
  "Editorial issue",
  "Other",
] as const;

export const FINDING_STATUSES = ["Open", "Addressed", "Verified", "Rejected", "Deferred"] as const;
export const FINDING_SEVERITIES = ["Critical", "Major", "Minor", "Info"] as const;

export type FindingType = (typeof FINDING_TYPES)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface SourceLocation {
  readonly projectId: string;
  readonly revisionId: string;
  readonly artifactId: string;
  readonly sliceId: string;
  readonly path: string;
  readonly location: string;
  readonly title: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly locator?: string;
}

export interface EvidenceAttachment {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly mediaType: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly addedAt: string;
}

export interface FindingVerification {
  readonly id: string;
  readonly revisionId: string;
  readonly source: SourceLocation;
  readonly verifiedAt: string;
  readonly note?: string;
}

export interface FindingHistory {
  readonly id: string;
  readonly at: string;
  readonly action: "Created" | "Edited" | "Status changed" | "Evidence added" | "Verified";
  readonly status: FindingStatus;
  readonly note?: string;
  readonly previousStatus?: FindingStatus;
}

export interface Finding {
  readonly id: string;
  readonly type: FindingType;
  readonly status: FindingStatus;
  readonly description: string;
  readonly source: SourceLocation;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly severity?: FindingSeverity;
  readonly resolution?: string;
  readonly externalReference?: string;
  readonly relatedFindingId?: string;
  readonly evidenceAttachments: readonly EvidenceAttachment[];
  readonly verifications: readonly FindingVerification[];
  readonly history: readonly FindingHistory[];
}

export interface CreateFindingInput {
  readonly id?: string;
  readonly type: FindingType;
  readonly description: string;
  readonly source: SourceLocation;
  readonly severity?: FindingSeverity;
  readonly resolution?: string;
  readonly externalReference?: string;
  readonly relatedFindingId?: string;
  readonly evidenceAttachments?: readonly EvidenceAttachment[];
}

export interface EditFindingInput {
  readonly type?: FindingType;
  readonly description?: string;
  readonly source?: SourceLocation;
  readonly severity?: FindingSeverity | null;
  readonly resolution?: string | null;
  readonly externalReference?: string | null;
  readonly relatedFindingId?: string | null;
}

export interface FindingFilter {
  readonly query?: string;
  readonly projectId?: string;
  readonly revisionId?: string;
  readonly artifactId?: string;
  readonly sliceId?: string;
  readonly type?: FindingType;
  readonly status?: FindingStatus;
  readonly severity?: FindingSeverity;
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

export interface FindingsSnapshot {
  readonly schemaVersion: "1.0";
  readonly generation: number;
  readonly findings: readonly Finding[];
}

export interface FindingsPersistence {
  load(): Promise<FindingsSnapshot | undefined>;
  save(snapshot: FindingsSnapshot): Promise<void>;
}

export interface SourceNavigator {
  openSource(source: SourceLocation): void | Promise<void>;
}

export interface FindingsClock { now(): string; }
export interface FindingsIdentifierSource {
  next(kind: "finding" | "history" | "verification"): string;
}

export interface FindingsManagementOptions {
  readonly persistence: FindingsPersistence;
  readonly navigator: SourceNavigator;
  readonly clock?: FindingsClock;
  readonly identifiers?: FindingsIdentifierSource;
}
