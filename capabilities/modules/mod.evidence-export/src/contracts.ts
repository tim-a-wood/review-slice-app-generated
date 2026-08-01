export const evidenceFileNames = [
  "review-summary.md",
  "findings.csv",
  "review-history.json",
  "slice-manifest.json",
  "source-manifest.json",
] as const;

export type EvidenceFileName = (typeof evidenceFileNames)[number];

export type ReviewState =
  | "Not Reviewed"
  | "Accepted"
  | "Finding"
  | "Question"
  | "Skipped"
  | "Re-review Required";

export type RevisionState =
  | "Unchanged"
  | "Modified"
  | "Added"
  | "Removed"
  | "Relocated"
  | "Unmatched";

export interface ProjectRecord {
  id: string;
  name: string;
  dataLocation: string;
}

export interface RevisionRecord {
  id: string;
  label: string;
  importedAt: string;
}

export interface ReviewDates {
  startedAt: string;
  completedAt?: string;
  exportedAt: string;
}

export interface SourceRecord {
  id: string;
  path: string;
  content?: string;
  hash?: string;
}

export interface SliceRecord {
  id: string;
  matchKey: string;
  sourceId: string;
  location: string;
  title: string;
  sequence: number;
  reviewState: ReviewState;
  revisionState: RevisionState;
  contentHash: string;
  parentId?: string;
  reviewedAt?: string;
  skippedReason?: string;
}

export interface FindingRecord {
  id: string;
  type: string;
  description: string;
  status: string;
  sourceSliceId: string;
  sourceLocation: string;
  createdAt: string;
  severity?: string;
  resolution?: string;
  externalReference?: string;
  relatedFindingId?: string;
  evidenceAttachment?: string;
}

export interface HistoryRecord {
  id: string;
  occurredAt: string;
  action: string;
  sliceId?: string;
  findingId?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface EvidenceExportData {
  project: ProjectRecord;
  revision: RevisionRecord;
  reviewDates: ReviewDates;
  slices: readonly SliceRecord[];
  findings: readonly FindingRecord[];
  history: readonly HistoryRecord[];
  sources: readonly SourceRecord[];
}

export interface EvidenceFile {
  name: EvidenceFileName;
  content: Uint8Array;
}

export interface EvidencePackage {
  files: readonly EvidenceFile[];
  zip: Uint8Array;
}
