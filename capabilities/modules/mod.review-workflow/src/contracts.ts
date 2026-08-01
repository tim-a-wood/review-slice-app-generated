export type ReviewState = "not-reviewed" | "accepted" | "finding" | "question" | "skipped" | "re-review-required";
export type RevisionState = "unchanged" | "modified" | "added" | "removed" | "relocated" | "unmatched";

export interface SourceLink {
  readonly artifactId: string;
  readonly path: string;
  readonly location: string;
}

export interface ReviewSlice {
  readonly id: string;
  readonly matchKey: string;
  readonly title: string;
  readonly sequence: number;
  readonly source: SourceLink;
  readonly revisionState: RevisionState;
  readonly contentHash: string;
  readonly reviewState: ReviewState;
  readonly skipReason?: string;
  readonly notes: readonly string[];
  readonly reviewedAt?: string;
}

export interface ReviewHistoryEntry {
  readonly id: string;
  readonly sliceId: string;
  readonly action: "decision" | "note" | "selection" | "recovery";
  readonly value: string;
  readonly occurredAt: string;
}

export interface ReviewProject {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeSliceId?: string;
  readonly slices: readonly ReviewSlice[];
  readonly history: readonly ReviewHistoryEntry[];
}

export interface ProjectStore {
  loadPrimary(projectId: string): Promise<ReviewProject | undefined>;
  loadBackup(projectId: string): Promise<ReviewProject | undefined>;
  savePrimary(project: ReviewProject): Promise<void>;
  saveBackup(project: ReviewProject): Promise<void>;
}

export interface Clock { now(): string; }
export interface IdentifierSource { next(): string; }
