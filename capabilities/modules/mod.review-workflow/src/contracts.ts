export const REVIEW_STATES = [
  "not-reviewed",
  "accepted",
  "finding",
  "question",
  "skipped",
  "re-review-required",
] as const;

export const REVISION_STATES = [
  "unchanged",
  "modified",
  "added",
  "removed",
  "relocated",
  "unmatched",
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];
export type RevisionState = (typeof REVISION_STATES)[number];
export type ProjectEvent =
  | "project-created"
  | "project-renamed"
  | "project-archived"
  | "project-restored"
  | "project-opened"
  | "revision-added"
  | "slice-selected"
  | "decision-recorded"
  | "note-added";

export interface SourceLink {
  readonly artifactId: string;
  readonly path: string;
  readonly location: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly locator?: string;
}

export interface ReviewNote {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface ReviewSlice {
  readonly id: string;
  readonly revisionId: string;
  readonly stableMatchKey: string;
  readonly parentId?: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly sequence: number;
  readonly source: SourceLink;
  readonly reviewState: ReviewState;
  readonly revisionState: RevisionState;
  readonly previousReviewState?: ReviewState;
  readonly previousSliceId?: string;
  readonly skipReason?: string;
  readonly notes: readonly ReviewNote[];
  readonly reviewedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewSliceInput {
  readonly id: string;
  readonly stableMatchKey: string;
  readonly parentId?: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly sequence: number;
  readonly source: SourceLink;
  readonly revisionState?: RevisionState;
  readonly reviewState?: ReviewState;
  /** Explicit cross-revision link used when a reviewer confirms a mapping whose stable key changed. */
  readonly previousSliceId?: string;
}

export interface ArtifactRevision {
  readonly id: string;
  readonly label: string;
  readonly fileName: string;
  readonly fileHash: string;
  readonly artifactType: string;
  readonly parserVersion: string;
  readonly importedAt: string;
  readonly slices: readonly ReviewSlice[];
}

export interface ArtifactRevisionInput {
  readonly id?: string;
  readonly label: string;
  readonly fileName: string;
  readonly fileHash: string;
  readonly artifactType: string;
  readonly parserVersion: string;
  readonly importedAt?: string;
  readonly slices: readonly ReviewSliceInput[];
}

export interface ReviewDecision {
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly sliceId: string;
  readonly state: ReviewState;
  readonly comment?: string;
  readonly skipReason?: string;
  readonly inheritedFromDecisionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewHistoryEntry {
  readonly id: string;
  readonly projectId: string;
  readonly revisionId?: string;
  readonly sliceId?: string;
  readonly event: ProjectEvent;
  readonly value: string;
  readonly previousValue?: string;
  readonly occurredAt: string;
}

export interface ReviewProject {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
  readonly activeRevisionId?: string;
  readonly activeSliceId?: string;
  readonly revisions: readonly ArtifactRevision[];
  readonly decisions: readonly ReviewDecision[];
  readonly history: readonly ReviewHistoryEntry[];
}

export interface ReviewWorkspaceSnapshot {
  readonly schemaVersion: "1.0";
  readonly generation: number;
  readonly activeProjectId?: string;
  readonly projects: readonly ReviewProject[];
}

export interface PersistedWorkflowEnvelope {
  readonly schemaVersion: "1.0";
  readonly generation: number;
  readonly savedAt: string;
  readonly snapshot: ReviewWorkspaceSnapshot;
}

export interface WorkflowRecoveryMetadata {
  readonly source: "new" | "primary" | "backup";
  readonly recovered: boolean;
  readonly recoveredAt: string;
  readonly primaryGeneration?: number;
  readonly backupGeneration?: number;
  readonly reason?: string;
}

export interface WorkflowPersistencePort {
  loadPrimary(): Promise<PersistedWorkflowEnvelope | undefined>;
  loadBackup(): Promise<PersistedWorkflowEnvelope | undefined>;
  savePrimary(envelope: PersistedWorkflowEnvelope): Promise<void>;
  saveBackup(envelope: PersistedWorkflowEnvelope): Promise<void>;
}

export interface WorkflowClock {
  now(): string;
}

export interface WorkflowIdentifierSource {
  next(kind: "project" | "revision" | "decision" | "note" | "history"): string;
}

export interface CreateReviewProjectInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly initialRevision?: ArtifactRevisionInput;
}

export interface DecisionInput {
  readonly state: ReviewState;
  readonly comment?: string;
  readonly skipReason?: string;
}

export interface SliceFilter {
  readonly reviewStates?: readonly ReviewState[];
  readonly revisionStates?: readonly RevisionState[];
  readonly hasNotes?: boolean;
  readonly query?: string;
  readonly includeRemoved?: boolean;
}

export interface ReviewWorkflowOptions {
  readonly persistence: WorkflowPersistencePort;
  readonly clock?: WorkflowClock;
  readonly identifiers?: WorkflowIdentifierSource;
}
