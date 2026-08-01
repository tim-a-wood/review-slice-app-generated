import type { EvidenceExportData, RevisionState, ReviewState } from "./contracts.ts";

const reviewStates: readonly ReviewState[] = [
  "Not Reviewed",
  "Accepted",
  "Finding",
  "Question",
  "Skipped",
  "Re-review Required",
];
const revisionStates: readonly RevisionState[] = [
  "Unchanged",
  "Modified",
  "Added",
  "Removed",
  "Relocated",
  "Unmatched",
];

export function validateEvidenceExport(data: EvidenceExportData): void {
  requireText(data.project.id, "project.id");
  requireText(data.project.name, "project.name");
  requireText(data.project.dataLocation, "project.dataLocation");
  requireText(data.revision.id, "revision.id");
  requireText(data.revision.label, "revision.label");
  requireDate(data.revision.importedAt, "revision.importedAt");
  requireDate(data.reviewDates.startedAt, "reviewDates.startedAt");
  requireDate(data.reviewDates.exportedAt, "reviewDates.exportedAt");
  if (data.reviewDates.completedAt) requireDate(data.reviewDates.completedAt, "reviewDates.completedAt");

  const sourceIds = new Set<string>();
  for (const source of data.sources) {
    requireText(source.id, "source.id");
    requireText(source.path, "source.path");
    if (source.content === undefined && !source.hash?.trim()) {
      throw new Error(`Source ${source.id} requires content or hash.`);
    }
    requireUnique(sourceIds, source.id, "Source");
  }

  const sliceIds = new Set<string>();
  for (const slice of data.slices) {
    requireText(slice.id, "slice.id");
    requireText(slice.matchKey, "slice.matchKey");
    requireText(slice.title, "slice.title");
    requireText(slice.location, "slice.location");
    requireText(slice.contentHash, "slice.contentHash");
    if (!sourceIds.has(slice.sourceId)) throw new Error(`Slice ${slice.id} references an unknown source.`);
    if (!Number.isInteger(slice.sequence)) throw new Error(`Slice ${slice.id} requires an integer sequence.`);
    if (!reviewStates.includes(slice.reviewState)) throw new Error(`Slice ${slice.id} has an unknown review state.`);
    if (!revisionStates.includes(slice.revisionState)) throw new Error(`Slice ${slice.id} has an unknown revision state.`);
    if (slice.reviewState === "Skipped" && !slice.skippedReason?.trim()) {
      throw new Error(`Skipped slice ${slice.id} requires a reason.`);
    }
    requireUnique(sliceIds, slice.id, "Slice");
  }
}

function requireText(value: string, name: string): void {
  if (!value?.trim()) throw new Error(`${name} requires a value.`);
}

function requireDate(value: string, name: string): void {
  if (!value?.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} requires an ISO date.`);
  }
}

function requireUnique(values: Set<string>, value: string, type: string): void {
  if (values.has(value)) throw new Error(`${type} ID ${value} is not unique.`);
  values.add(value);
}
