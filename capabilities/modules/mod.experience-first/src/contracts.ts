import type { ArtifactSlice, ProcessingViewActions, ProcessingViewState, RevisionCandidate, ReviewerMapping } from "../../mod.artifact-processing/src/contracts.ts";
import type { EvidenceExportData } from "../../mod.evidence-export/src/contracts.ts";
import type { Finding } from "../../mod.findings/src/contracts.ts";
import type { ReviewProject, ReviewSlice } from "../../mod.review-workflow/src/contracts.ts";

export type WorkspacePage = "dashboard" | "import" | "review" | "revisions" | "mappings" | "findings" | "exports";
export type AsyncState = "ready" | "loading" | "empty" | "error";

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  totalSlices: number;
  openFindings: number;
  reReviewCount: number;
  completionPercent: number;
}

export interface RevisionView {
  label: string;
  importedAt: string;
  previousLabel?: string;
  counts: Record<ReviewSlice["revisionState"], number>;
  candidates: readonly RevisionCandidate[];
}

export interface MappingView {
  candidate: RevisionCandidate;
  previous?: ArtifactSlice;
  current?: ArtifactSlice;
}

export interface WorkspaceData {
  project?: ReviewProject;
  projects: readonly ProjectSummary[];
  slices: readonly ArtifactSlice[];
  findings: readonly Finding[];
  importState: ProcessingViewState;
  revision?: RevisionView;
  mappings: readonly MappingView[];
  exportData?: EvidenceExportData;
  dataPath: string;
}

export interface WorkspaceActions {
  processing: ProcessingViewActions;
  openProject(projectId: string): void | Promise<void>;
  createProject(): void | Promise<void>;
  importRevision(): void | Promise<void>;
  exportEvidence(): void | Promise<void>;
  selectSlice(sliceId: string): void | Promise<void>;
  decide(sliceId: string, state: Exclude<ReviewSlice["reviewState"], "skipped">): void | Promise<void>;
  skip(sliceId: string, reason: string): void | Promise<void>;
  addNote(sliceId: string, note: string): void | Promise<void>;
  createFinding(sliceId: string, type: "finding" | "question", description: string): void | Promise<void>;
  updateFinding(findingId: string, status: Finding["status"], note?: string): void | Promise<void>;
  openFindingSource(findingId: string): void | Promise<void>;
  correctMapping(mapping: ReviewerMapping): void | Promise<void>;
}

export interface WorkspaceState {
  page: WorkspacePage;
  status: AsyncState;
  data: WorkspaceData;
  error?: string;
  savedAt?: string;
}

export interface UserWorkspace {
  render(state: WorkspaceState): void;
  destroy(): void;
}
