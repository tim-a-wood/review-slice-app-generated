import type {
  ArtifactImportResult,
  ArtifactKind,
  ArtifactSlice,
  ImportWarning,
  RevisionCandidate,
  RevisionComparison,
  ReviewerMapping,
  SlicingOptions,
  SliceStrategy,
} from "../../mod.artifact-processing/src/contracts.ts";
import type { EvidenceExportResult } from "../../mod.evidence-export/src/contracts.ts";
import type {
  Finding as ManagedFinding,
  FindingSeverity,
  FindingStatus,
  FindingType,
} from "../../mod.findings/src/contracts.ts";
import type {
  ReviewProject,
  ReviewSlice,
} from "../../mod.review-workflow/src/contracts.ts";
import type { ArtifactProcessing } from "../../mod.artifact-processing/src/contracts.ts";
import type { EvidenceExportService } from "../../mod.evidence-export/src/contracts.ts";
import type { FindingsManagement } from "../../mod.findings/src/findings-store.ts";
import type { ReviewWorkflow } from "../../mod.review-workflow/src/review-workflow.ts";

/** Pages owned by the single Review Slice presentation module. */
export type WorkspacePage = "dashboard" | "import" | "review" | "revisions" | "mappings" | "findings" | "evidence";
export type AsyncState = "loading" | "ready" | "empty" | "error";
export type ReviewState = "not-reviewed" | "accepted" | "finding" | "question" | "skipped" | "re-review-required";
export type RevisionState = "unchanged" | "modified" | "added" | "removed" | "relocated" | "unmatched";

/** Compatibility projection retained for the unchanged deployable verification suite. */
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

export interface RevisionMapping {
  previousSliceId: string;
  currentSliceId: string;
  revisionState: RevisionState;
}

export interface RevisionResult {
  current: readonly Slice[];
  removed: readonly Slice[];
  mappings: readonly RevisionMapping[];
  counts: Record<RevisionState, number>;
}

export type ImportPhase = "select" | "detect" | "preview" | "confirm";
export type ImportMode = "new-project" | "revision";

export interface SelectedSource {
  displayName: string;
  relativePath: string;
  bytes: Uint8Array;
  kind?: ArtifactKind;
}

export interface ImportDraft {
  phase: ImportPhase;
  mode: ImportMode;
  projectName: string;
  revisionLabel: string;
  sources: readonly SelectedSource[];
  options: SlicingOptions;
  detectedKind?: ArtifactKind;
  result?: ArtifactImportResult;
  warnings: readonly ImportWarning[];
  excludedMatchKeys: readonly string[];
  busy: boolean;
}

export interface ComparisonState {
  previousLabel: string;
  currentLabel: string;
  comparison: RevisionComparison;
  confirmedMappings: readonly ReviewerMapping[];
  rejectedCandidateKeys: readonly string[];
  importedAt: string;
}

export interface ProjectRow {
  project: ReviewProject;
  completionPercent: number;
  remaining: number;
  openFindings: number;
  reReview: number;
}

export interface WorkspaceView {
  page: WorkspacePage;
  status: AsyncState;
  projects: readonly ProjectRow[];
  project?: ReviewProject;
  revisionLabel?: string;
  previousRevisionLabel?: string;
  slices: readonly ReviewSlice[];
  findings: readonly ManagedFinding[];
  importDraft: ImportDraft;
  comparison?: ComparisonState;
  activeSlice?: ReviewSlice;
  previousSlice?: ReviewSlice;
  filter: string;
  query: string;
  findingQuery: string;
  findingStatus: "all" | FindingStatus;
  showDiff: boolean;
  dataPath: string;
  savedAt?: string;
  notice?: string;
  error?: string;
  exportResult?: EvidenceExportResult;
  dialog?: WorkspaceDialog;
}

export interface WorkspaceDialog {
  kind: "finding" | "question" | "edit-finding" | "skip" | "note" | "rename" | "delete" | "resolution";
  title: string;
  description: string;
  targetId: string;
  initialValue?: string;
  findingType?: FindingType;
  findingSeverity?: FindingSeverity;
}

export interface FindingDraft {
  type: FindingType;
  severity?: FindingSeverity;
  description: string;
}

export interface UserWorkspaceOptions {
  /** A clear local location label. The desktop adapter can supply the Windows application-data path. */
  dataPath?: string;
  initialPage?: WorkspacePage;
  storage?: Storage;
  /** Opt-in sample data for demonstrations and UI tests. Production starts with an empty workspace. */
  seedDemo?: boolean;
  /** Optional adapter-owned save operation. No document content is sent over a network. */
  saveFile?: (name: string, content: Uint8Array, mediaType: string) => void | Promise<void>;
}

export interface WorkspaceServices {
  artifact: ArtifactProcessing;
  workflow: ReviewWorkflow;
  findings: FindingsManagement;
  evidence: EvidenceExportService;
}

export interface UserWorkspaceMountOptions extends UserWorkspaceOptions {
  services: WorkspaceServices;
}

export interface UserWorkspace {
  open(page: WorkspacePage): void;
  refresh(): void;
  destroy(): void;
}

export type {
  ArtifactImportResult,
  ArtifactSlice,
  FindingSeverity,
  FindingStatus,
  FindingType,
  ManagedFinding,
  ReviewProject,
  ReviewSlice,
  ReviewerMapping,
  SliceStrategy,
};
