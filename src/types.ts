export type Page = "dashboard" | "import" | "review" | "revisions" | "mappings" | "findings" | "exports";
export type ReviewState = "not-reviewed" | "accepted" | "finding" | "question" | "skipped" | "re-review-required";
export type RevisionState = "unchanged" | "modified" | "added" | "removed" | "relocated" | "unmatched";

export interface SliceSource {
  path: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  locator?: string;
}

export interface Slice {
  id: string;
  title: string;
  content: string;
  location: string;
  sequence: number;
  reviewState: ReviewState;
  revisionState: RevisionState;
  findingIds: string[];
  matchKey?: string;
  artifactId?: string;
  sourceHash?: string;
  contentHash?: string;
  source?: SliceSource;
  priorReviewState?: ReviewState;
  note?: string;
  skipReason?: string;
}

export interface Finding {
  id: string;
  type: "Defect" | "Question" | "Improvement";
  description: string;
  status: "Open" | "Addressed" | "Verified" | "Rejected" | "Deferred";
  sliceId: string;
  createdAt: string;
}

export interface RevisionSummary {
  importedAt: string;
  counts: Record<RevisionState, number>;
  previousProjectName?: string;
}

export interface AppState {
  projectName: string;
  dataPath: string;
  slices: Slice[];
  findings: Finding[];
  activeSliceId: string;
  updatedAt: string;
  hasImportedArtifact?: boolean;
  revision?: RevisionSummary;
}

export interface DesktopApi {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  importArtifact(): Promise<AppState | undefined>;
  exportEvidence(state: AppState): Promise<string>;
  dataPath(): Promise<string>;
}

declare global { interface Window { reviewSlice?: DesktopApi; } }
