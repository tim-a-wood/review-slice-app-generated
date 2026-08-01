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
  artifactId: string;
  path: string;
  sliceId: string;
  location: string;
  title: string;
}

export interface EvidenceAttachment {
  name: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
  addedAt: string;
}

export interface FindingHistory {
  at: string;
  action: "Created" | "Updated" | "Status changed" | "Verified";
  status: FindingStatus;
  note?: string;
}

export interface Finding {
  id: string;
  type: FindingType;
  status: FindingStatus;
  description: string;
  source: SourceLocation;
  createdAt: string;
  updatedAt: string;
  severity?: FindingSeverity;
  resolutionNote?: string;
  externalReference?: string;
  relatedFindingId?: string;
  evidence?: EvidenceAttachment[];
  verifiedRevisionId?: string;
  verifiedAt?: string;
  history: readonly FindingHistory[];
}

export interface CreateFindingInput {
  type: FindingType;
  description: string;
  source: SourceLocation;
  severity?: FindingSeverity;
  externalReference?: string;
  relatedFindingId?: string;
  evidence?: EvidenceAttachment[];
}

export interface UpdateFindingInput {
  description?: string;
  severity?: FindingSeverity;
  resolutionNote?: string;
  externalReference?: string;
  relatedFindingId?: string;
  evidence?: EvidenceAttachment[];
}

export interface FindingFilter {
  query?: string;
  status?: FindingStatus;
  type?: FindingType;
  severity?: FindingSeverity;
  sliceId?: string;
}

export interface FindingsPersistence {
  load(): Promise<readonly Finding[]>;
  save(findings: readonly Finding[]): Promise<void>;
}

export interface SourceNavigator {
  openSource(source: SourceLocation): void | Promise<void>;
}
