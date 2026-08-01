import { createHash } from "node:crypto";
import type { EvidenceExportData, FindingRecord, SliceRecord, SourceRecord } from "./contracts.ts";

const reviewStateOrder = ["Not Reviewed", "Accepted", "Finding", "Question", "Skipped", "Re-review Required"];
const revisionStateOrder = ["Unchanged", "Modified", "Added", "Removed", "Relocated", "Unmatched"];

export function createReviewSummary(data: EvidenceExportData): string {
  const reviewCounts = count(data.slices, (slice) => slice.reviewState, reviewStateOrder);
  const revisionCounts = count(data.slices, (slice) => slice.revisionState, revisionStateOrder);
  const reviewed = data.slices.filter((slice) => slice.reviewState !== "Not Reviewed" && slice.reviewState !== "Re-review Required");
  const completion = data.slices.length === 0 ? 0 : (reviewed.length / data.slices.length) * 100;
  const questions = data.slices.filter((slice) => slice.reviewState === "Question");
  const skipped = data.slices.filter((slice) => slice.reviewState === "Skipped");
  const findingCounts = count(data.findings, (finding) => finding.status);
  const lines = [
    "# Review Summary", "", "## Project", "",
    `- ID: ${markdown(data.project.id)}`,
    `- Name: ${markdown(data.project.name)}`,
    `- Data location: ${markdown(data.project.dataLocation)}`,
    "", "## Revision", "",
    `- ID: ${markdown(data.revision.id)}`,
    `- Label: ${markdown(data.revision.label)}`,
    `- Imported: ${markdown(data.revision.importedAt)}`,
    "", "## Review Dates", "",
    `- Started: ${markdown(data.reviewDates.startedAt)}`,
    `- Completed: ${markdown(data.reviewDates.completedAt ?? "Not completed")}`,
    `- Exported: ${markdown(data.reviewDates.exportedAt)}`,
    "", "## Completion", "",
    `- Reviewed slices: ${reviewed.length} of ${data.slices.length}`,
    `- Completion: ${completion.toFixed(2)}%`,
    "", "## Review States", "", ...countTable(reviewCounts),
    "", "## Revision States", "", ...countTable(revisionCounts),
    "", "## Findings", "", `- Total findings: ${data.findings.length}`,
    ...findingCounts.map(([name, total]) => `- ${markdown(name)}: ${total}`),
    "", "## Unresolved Questions", "",
    ...(questions.length ? sortSlices(questions).map((slice) => `- ${markdown(slice.id)}: ${markdown(slice.title)}`) : ["- None"]),
    "", "## Skipped Sections", "",
    ...(skipped.length ? sortSlices(skipped).map((slice) => `- ${markdown(slice.id)}: ${markdown(slice.title)} — ${markdown(slice.skippedReason ?? "")}`) : ["- None"]),
    "", "## Source Hashes", "",
    ...sourceManifest(data.sources).map((source) => `- ${markdown(source.path)}: \`${source.hash}\``), "",
  ];
  return lines.join("\n");
}

export function createFindingsCsv(findings: readonly FindingRecord[]): string {
  const header = ["id", "type", "description", "status", "sourceSliceId", "sourceLocation", "createdAt", "severity", "resolution", "externalReference", "relatedFindingId", "evidenceAttachment"];
  const rows = sortFindings(findings).map((finding) => [
    finding.id, finding.type, finding.description, finding.status, finding.sourceSliceId, finding.sourceLocation,
    finding.createdAt, finding.severity ?? "", finding.resolution ?? "", finding.externalReference ?? "",
    finding.relatedFindingId ?? "", finding.evidenceAttachment ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n";
}

export function createFindingsJson(findings: readonly FindingRecord[]): string {
  return stableJson(sortFindings(findings)) + "\n";
}

export function createReviewHistoryJson(data: EvidenceExportData): string {
  const history = [...data.history].sort((left, right) => compare(left.occurredAt, right.occurredAt) || compare(left.id, right.id));
  return stableJson({ projectId: data.project.id, revisionId: data.revision.id, reviewDates: data.reviewDates, history }) + "\n";
}

export function createSliceManifestJson(data: EvidenceExportData): string {
  const slices = sortSlices(data.slices).map((slice) => ({
    ...slice, parentId: slice.parentId ?? null, reviewedAt: slice.reviewedAt ?? null, skippedReason: slice.skippedReason ?? null,
  }));
  return stableJson({ projectId: data.project.id, revisionId: data.revision.id, slices }) + "\n";
}

export function createSourceManifestJson(data: EvidenceExportData): string {
  return stableJson({ projectId: data.project.id, revisionId: data.revision.id, sources: sourceManifest(data.sources) }) + "\n";
}

export function sourceManifest(sources: readonly SourceRecord[]) {
  return [...sources]
    .map((source) => ({ id: source.id, path: source.path, hash: source.hash ?? sha256Utf8(source.content ?? "") }))
    .sort((left, right) => compare(left.path, right.path) || compare(left.id, right.id));
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function count<T>(items: readonly T[], value: (item: T) => string, known: readonly string[] = []) {
  const counts = new Map<string, number>(known.map((item) => [item, 0]));
  for (const item of items) counts.set(value(item), (counts.get(value(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => order(left, known) - order(right, known) || compare(left, right));
}

function order(value: string, known: readonly string[]): number {
  const index = known.indexOf(value);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function countTable(counts: readonly [string, number][]): string[] {
  return ["| State | Count |", "| --- | ---: |", ...counts.map(([name, total]) => `| ${markdown(name)} | ${total} |`)];
}

function sortSlices(slices: readonly SliceRecord[]): SliceRecord[] {
  return [...slices].sort((left, right) => left.sequence - right.sequence || compare(left.id, right.id));
}

function sortFindings(findings: readonly FindingRecord[]): FindingRecord[] {
  return [...findings].sort((left, right) => compare(left.createdAt, right.createdAt) || compare(left.id, right.id));
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function markdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compare(left, right)).map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
