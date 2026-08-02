export const evidencePackageFileNames = [
  "review-summary.md",
  "findings.csv",
  "review-history.json",
  "slice-manifest.json",
  "source-manifest.json",
] as const;

export const evidenceDownloadNames = [
  "review-summary.md",
  "findings.csv",
  "findings.json",
  "review-history.json",
  "slice-manifest.json",
  "source-manifest.json",
  "review-evidence.zip",
] as const;

/** Compatibility alias for the five files required in the evidence ZIP. */
export const evidenceFileNames = evidencePackageFileNames;

export type EvidenceFileName = (typeof evidencePackageFileNames)[number];
export type EvidenceDownloadName = (typeof evidenceDownloadNames)[number];

export const reviewStates = [
  "Not Reviewed",
  "Accepted",
  "Finding",
  "Question",
  "Skipped",
  "Re-review Required",
] as const;

export const revisionStates = [
  "Unchanged",
  "Modified",
  "Added",
  "Removed",
  "Relocated",
  "Unmatched",
] as const;

export const findingTypes = [
  "Defect",
  "Question",
  "Improvement",
  "Inconsistency",
  "Missing information",
  "Traceability issue",
  "Editorial issue",
  "Other",
] as const;

export const findingStatuses = ["Open", "Addressed", "Verified", "Rejected", "Deferred"] as const;

export type ReviewState = (typeof reviewStates)[number];
export type RevisionState = (typeof revisionStates)[number];
export type FindingType = (typeof findingTypes)[number];
export type FindingStatus = (typeof findingStatuses)[number];

export interface ProjectRecord {
  id: string;
  name: string;
  dataLocation: string;
  description?: string;
  artifactType?: string;
}

export interface RevisionRecord {
  id: string;
  label: string;
  importedAt: string;
  fileName?: string;
  fileHash?: string;
  parserVersion?: string;
}

export interface ReviewDates {
  startedAt: string;
  completedAt?: string;
  exportedAt: string;
}

export interface SourceRecord {
  id: string;
  path: string;
  /** Source content is used only to calculate a missing hash and is never exported. */
  content?: string;
  /** A real SHA-256 digest supplied by the source owner. */
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
  type: FindingType;
  description: string;
  status: FindingStatus;
  sourceSliceId: string;
  sourceLocation: string;
  createdAt: string;
  updatedAt?: string;
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
  mediaType: string;
  content: Uint8Array;
  contentHash: string;
}

export interface EvidenceDownload {
  name: EvidenceDownloadName;
  mediaType: string;
  content: Uint8Array;
  contentHash: string;
}

export interface EvidencePackage {
  files: readonly EvidenceFile[];
  zip: Uint8Array;
  contentHash: string;
}

export interface EvidenceCounts {
  totalSlices: number;
  reviewableSlices: number;
  reviewedSlices: number;
  remainingSlices: number;
  completionPercent: number;
  questionSlices: number;
  unresolvedQuestionFindings: number;
  skippedSlices: number;
  totalFindings: number;
  reviewStates: Readonly<Record<ReviewState, number>>;
  revisionStates: Readonly<Record<RevisionState, number>>;
  findingStatuses: Readonly<Record<FindingStatus, number>>;
  findingTypes: Readonly<Record<FindingType, number>>;
}

export interface EvidenceExportResult {
  counts: EvidenceCounts;
  downloads: readonly EvidenceDownload[];
  evidencePackage: EvidencePackage;
}

export interface EvidenceDiagnostic {
  code: string;
  path: string;
  message: string;
}

export interface EvidenceExportService {
  execute(data: EvidenceExportData): EvidenceExportResult;
  exportEvidence(data: EvidenceExportData): EvidenceExportResult;
  createPackage(data: EvidenceExportData): EvidencePackage;
  createFindingsRegister(data: EvidenceExportData, format: "csv" | "json"): Uint8Array;
  diagnose(data: EvidenceExportData): readonly EvidenceDiagnostic[];
  validate(data: EvidenceExportData): void;
}
