import {
  findingStatuses,
  findingTypes,
  revisionStates,
  reviewStates,
  type EvidenceDiagnostic,
  type EvidenceExportData,
} from "./contracts.ts";
import { sha256Utf8 } from "./serialize.ts";

const sha256Pattern = /^[a-f0-9]{64}$/i;

export class EvidenceValidationError extends Error {
  readonly diagnostics: readonly EvidenceDiagnostic[];

  constructor(diagnostics: readonly EvidenceDiagnostic[]) {
    super(`Evidence export is invalid (${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}).`);
    this.name = "EvidenceValidationError";
    this.diagnostics = diagnostics;
  }
}

export function validateEvidenceExport(data: EvidenceExportData): void {
  const diagnostics = diagnoseEvidenceExport(data);
  if (diagnostics.length > 0) throw new EvidenceValidationError(diagnostics);
}

export function diagnoseEvidenceExport(data: EvidenceExportData): readonly EvidenceDiagnostic[] {
  const diagnostics: EvidenceDiagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
  text(data?.project?.id, "project.id", add);
  text(data?.project?.name, "project.name", add);
  text(data?.project?.dataLocation, "project.dataLocation", add);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(data?.project?.dataLocation ?? "")) {
    add("EVIDENCE_LOCAL_ONLY", "project.dataLocation", "Project data must use a local location, not a network URL.");
  }
  text(data?.revision?.id, "revision.id", add);
  text(data?.revision?.label, "revision.label", add);
  date(data?.revision?.importedAt, "revision.importedAt", add);
  optionalHash(data?.revision?.fileHash, "revision.fileHash", add);
  date(data?.reviewDates?.startedAt, "reviewDates.startedAt", add);
  date(data?.reviewDates?.exportedAt, "reviewDates.exportedAt", add);
  if (data?.reviewDates?.completedAt !== undefined) date(data.reviewDates.completedAt, "reviewDates.completedAt", add);
  chronology(data, add);

  const sources = Array.isArray(data?.sources) ? data.sources : [];
  if (!Array.isArray(data?.sources)) add("EVIDENCE_ARRAY", "sources", "Sources must be an array.");
  const sourceIds = new Set<string>();
  for (const [index, source] of sources.entries()) {
    const path = `sources[${index}]`;
    text(source.id, `${path}.id`, add);
    text(source.path, `${path}.path`, add);
    unique(sourceIds, source.id, `${path}.id`, "source", add);
    if (source.content === undefined && !source.hash?.trim()) {
      add("EVIDENCE_SOURCE_HASH", path, "A source requires supplied content or a supplied SHA-256 hash.");
    }
    optionalHash(source.hash, `${path}.hash`, add);
    if (source.hash && source.content !== undefined && source.hash.toLowerCase() !== sha256Utf8(source.content)) {
      add("EVIDENCE_HASH_MISMATCH", `${path}.hash`, "The supplied source hash does not match the supplied UTF-8 content.");
    }
  }

  const slices = Array.isArray(data?.slices) ? data.slices : [];
  if (!Array.isArray(data?.slices)) add("EVIDENCE_ARRAY", "slices", "Slices must be an array.");
  const sliceIds = new Set<string>();
  for (const [index, slice] of slices.entries()) {
    const path = `slices[${index}]`;
    text(slice.id, `${path}.id`, add);
    text(slice.matchKey, `${path}.matchKey`, add);
    text(slice.sourceId, `${path}.sourceId`, add);
    text(slice.location, `${path}.location`, add);
    text(slice.title, `${path}.title`, add);
    hash(slice.contentHash, `${path}.contentHash`, add);
    unique(sliceIds, slice.id, `${path}.id`, "slice", add);
    if (!sourceIds.has(slice.sourceId)) {
      add("EVIDENCE_UNKNOWN_SOURCE", `${path}.sourceId`, `Slice ${slice.id || index} references an unknown source.`);
    }
    if (!Number.isSafeInteger(slice.sequence) || slice.sequence < 0) {
      add("EVIDENCE_SEQUENCE", `${path}.sequence`, "A slice sequence must be a non-negative safe integer.");
    }
    if (!reviewStates.includes(slice.reviewState)) {
      add("EVIDENCE_REVIEW_STATE", `${path}.reviewState`, "The review state is not supported.");
    }
    if (!revisionStates.includes(slice.revisionState)) {
      add("EVIDENCE_REVISION_STATE", `${path}.revisionState`, "The revision state is not supported.");
    }
    if (slice.reviewedAt !== undefined) date(slice.reviewedAt, `${path}.reviewedAt`, add);
    if (["Accepted", "Finding", "Question", "Skipped"].includes(slice.reviewState) && !slice.reviewedAt) {
      add("EVIDENCE_REVIEW_TIMESTAMP", `${path}.reviewedAt`, "A reviewed slice requires its supplied review timestamp.");
    }
    if (slice.reviewState === "Skipped" && !slice.skippedReason?.trim()) {
      add("EVIDENCE_SKIP_REASON", `${path}.skippedReason`, "A skipped slice requires a reason.");
    }
  }
  for (const [index, slice] of slices.entries()) {
    if (slice.parentId && !sliceIds.has(slice.parentId)) {
      add("EVIDENCE_UNKNOWN_PARENT", `slices[${index}].parentId`, `Slice ${slice.id} references an unknown parent.`);
    }
    if (slice.parentId === slice.id) {
      add("EVIDENCE_PARENT_CYCLE", `slices[${index}].parentId`, `Slice ${slice.id} cannot be its own parent.`);
    }
  }

  const findings = Array.isArray(data?.findings) ? data.findings : [];
  if (!Array.isArray(data?.findings)) add("EVIDENCE_ARRAY", "findings", "Findings must be an array.");
  const findingIds = new Set<string>();
  for (const [index, finding] of findings.entries()) {
    const path = `findings[${index}]`;
    text(finding.id, `${path}.id`, add);
    text(finding.description, `${path}.description`, add);
    text(finding.sourceSliceId, `${path}.sourceSliceId`, add);
    text(finding.sourceLocation, `${path}.sourceLocation`, add);
    date(finding.createdAt, `${path}.createdAt`, add);
    if (finding.updatedAt !== undefined) date(finding.updatedAt, `${path}.updatedAt`, add);
    unique(findingIds, finding.id, `${path}.id`, "finding", add);
    if (!findingTypes.includes(finding.type)) add("EVIDENCE_FINDING_TYPE", `${path}.type`, "The finding type is not supported.");
    if (!findingStatuses.includes(finding.status)) add("EVIDENCE_FINDING_STATUS", `${path}.status`, "The finding status is not supported.");
    if (!sliceIds.has(finding.sourceSliceId)) {
      add("EVIDENCE_UNKNOWN_SLICE", `${path}.sourceSliceId`, `Finding ${finding.id || index} references an unknown slice.`);
    }
    if (finding.updatedAt && validDate(finding.createdAt) && validDate(finding.updatedAt) && Date.parse(finding.updatedAt) < Date.parse(finding.createdAt)) {
      add("EVIDENCE_DATE_ORDER", `${path}.updatedAt`, "A finding update cannot precede its creation.");
    }
  }
  for (const [index, finding] of findings.entries()) {
    if (finding.relatedFindingId && !findingIds.has(finding.relatedFindingId)) {
      add("EVIDENCE_RELATED_FINDING", `findings[${index}].relatedFindingId`, "The related finding does not exist in this register.");
    }
    if (finding.relatedFindingId === finding.id) {
      add("EVIDENCE_RELATED_FINDING", `findings[${index}].relatedFindingId`, "A finding cannot relate to itself.");
    }
  }

  const history = Array.isArray(data?.history) ? data.history : [];
  if (!Array.isArray(data?.history)) add("EVIDENCE_ARRAY", "history", "Review history must be an array.");
  const historyIds = new Set<string>();
  for (const [index, record] of history.entries()) {
    const path = `history[${index}]`;
    text(record.id, `${path}.id`, add);
    text(record.action, `${path}.action`, add);
    date(record.occurredAt, `${path}.occurredAt`, add);
    unique(historyIds, record.id, `${path}.id`, "history record", add);
    if (record.sliceId && !sliceIds.has(record.sliceId)) {
      add("EVIDENCE_HISTORY_SLICE", `${path}.sliceId`, "The history record references an unknown slice.");
    }
    if (record.findingId && !findingIds.has(record.findingId)) {
      add("EVIDENCE_HISTORY_FINDING", `${path}.findingId`, "The history record references an unknown finding.");
    }
  }

  return diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
}

function chronology(data: EvidenceExportData, add: AddDiagnostic): void {
  const started = data?.reviewDates?.startedAt;
  const completed = data?.reviewDates?.completedAt;
  const exported = data?.reviewDates?.exportedAt;
  if (validDate(started) && validDate(completed) && Date.parse(completed) < Date.parse(started)) {
    add("EVIDENCE_DATE_ORDER", "reviewDates.completedAt", "Review completion cannot precede review start.");
  }
  if (validDate(started) && validDate(exported) && Date.parse(exported) < Date.parse(started)) {
    add("EVIDENCE_DATE_ORDER", "reviewDates.exportedAt", "Evidence export cannot precede review start.");
  }
  if (validDate(completed) && validDate(exported) && Date.parse(exported) < Date.parse(completed)) {
    add("EVIDENCE_DATE_ORDER", "reviewDates.exportedAt", "Evidence export cannot precede review completion.");
  }
}

type AddDiagnostic = (code: string, path: string, message: string) => void;

function text(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value !== "string" || !value.trim()) add("EVIDENCE_REQUIRED", path, "A non-empty value is required.");
}

function date(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value !== "string" || !validDate(value)) add("EVIDENCE_DATE", path, "A valid ISO 8601 date is required.");
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function hash(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value !== "string" || !sha256Pattern.test(value)) add("EVIDENCE_SHA256", path, "A 64-character SHA-256 hash is required.");
}

function optionalHash(value: unknown, path: string, add: AddDiagnostic): void {
  if (value !== undefined) hash(value, path, add);
}

function unique(values: Set<string>, value: string, path: string, type: string, add: AddDiagnostic): void {
  if (!value) return;
  if (values.has(value)) add("EVIDENCE_DUPLICATE_ID", path, `The ${type} ID is not unique.`);
  values.add(value);
}
