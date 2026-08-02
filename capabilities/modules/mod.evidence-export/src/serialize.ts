import {
  findingStatuses,
  findingTypes,
  revisionStates,
  reviewStates,
  type EvidenceCounts,
  type EvidenceExportData,
  type FindingRecord,
  type FindingStatus,
  type FindingType,
  type RevisionState,
  type ReviewState,
  type SliceRecord,
  type SourceRecord,
} from "./contracts.ts";

const encoder = new TextEncoder();
const completedReviewStates = new Set<ReviewState>(["Accepted", "Finding", "Question", "Skipped"]);
const resolvedQuestionStatuses = new Set<FindingStatus>(["Verified", "Rejected"]);

export function calculateEvidenceCounts(data: EvidenceExportData): EvidenceCounts {
  const reviewStateCounts = enumCounts(reviewStates);
  const revisionStateCounts = enumCounts(revisionStates);
  const findingStatusCounts = enumCounts(findingStatuses);
  const findingTypeCounts = enumCounts(findingTypes);

  for (const slice of data.slices) {
    reviewStateCounts[slice.reviewState] += 1;
    revisionStateCounts[slice.revisionState] += 1;
  }
  for (const finding of data.findings) {
    findingStatusCounts[finding.status] += 1;
    findingTypeCounts[finding.type] += 1;
  }

  const reviewable = data.slices.filter((slice) => slice.revisionState !== "Removed");
  const reviewed = reviewable.filter((slice) => completedReviewStates.has(slice.reviewState));
  const completionPercent = reviewable.length === 0 ? 0 : (reviewed.length / reviewable.length) * 100;

  return {
    totalSlices: data.slices.length,
    reviewableSlices: reviewable.length,
    reviewedSlices: reviewed.length,
    remainingSlices: reviewable.length - reviewed.length,
    completionPercent,
    questionSlices: reviewStateCounts.Question,
    unresolvedQuestionFindings: data.findings.filter(
      (finding) => finding.type === "Question" && !resolvedQuestionStatuses.has(finding.status),
    ).length,
    skippedSlices: reviewStateCounts.Skipped,
    totalFindings: data.findings.length,
    reviewStates: Object.freeze(reviewStateCounts),
    revisionStates: Object.freeze(revisionStateCounts),
    findingStatuses: Object.freeze(findingStatusCounts),
    findingTypes: Object.freeze(findingTypeCounts),
  };
}

export function createReviewSummary(data: EvidenceExportData): string {
  const counts = calculateEvidenceCounts(data);
  const questions = sortFindings(data.findings).filter(
    (finding) => finding.type === "Question" && !resolvedQuestionStatuses.has(finding.status),
  );
  const questionSlices = sortSlices(data.slices.filter((slice) => slice.reviewState === "Question"));
  const skipped = sortSlices(data.slices.filter((slice) => slice.reviewState === "Skipped"));
  const sources = sourceManifest(data.sources);
  const lines = [
    "# Review Summary",
    "",
    "## Project",
    "",
    `- ID: ${markdown(data.project.id)}`,
    `- Name: ${markdown(data.project.name)}`,
    `- Description: ${markdown(data.project.description ?? "Not supplied")}`,
    `- Artifact type: ${markdown(data.project.artifactType ?? "Not supplied")}`,
    `- Local data location: ${markdown(data.project.dataLocation)}`,
    "",
    "## Artifact Revision",
    "",
    `- ID: ${markdown(data.revision.id)}`,
    `- Label: ${markdown(data.revision.label)}`,
    `- File: ${markdown(data.revision.fileName ?? "Not supplied")}`,
    `- File hash: ${data.revision.fileHash ? `\`${data.revision.fileHash.toLowerCase()}\`` : "Not supplied"}`,
    `- Imported: ${markdown(data.revision.importedAt)}`,
    `- Parser version: ${markdown(data.revision.parserVersion ?? "Not supplied")}`,
    "",
    "## Review Dates",
    "",
    `- Started: ${markdown(data.reviewDates.startedAt)}`,
    `- Completed: ${markdown(data.reviewDates.completedAt ?? "Not completed")}`,
    `- Exported: ${markdown(data.reviewDates.exportedAt)}`,
    "",
    "## Completion",
    "",
    `- Total manifest slices: ${counts.totalSlices}`,
    `- Current reviewable slices: ${counts.reviewableSlices}`,
    `- Reviewed slices: ${counts.reviewedSlices}`,
    `- Remaining slices: ${counts.remainingSlices}`,
    `- Completion: ${counts.completionPercent.toFixed(2)}%`,
    "",
    "## Review-state Breakdown",
    "",
    ...countTable(reviewStates.map((state) => [state, counts.reviewStates[state]] as const)),
    "",
    "## Revision-change Breakdown",
    "",
    ...countTable(revisionStates.map((state) => [state, counts.revisionStates[state]] as const)),
    "",
    "## Finding Totals",
    "",
    `- Total findings: ${counts.totalFindings}`,
    "",
    "### By status",
    "",
    ...countTable(findingStatuses.map((status) => [status, counts.findingStatuses[status]] as const)),
    "",
    "### By type",
    "",
    ...countTable(findingTypes.map((type) => [type, counts.findingTypes[type]] as const)),
    "",
    "## Unresolved Questions",
    "",
    `- Question slices: ${counts.questionSlices}`,
    `- Unresolved question findings: ${counts.unresolvedQuestionFindings}`,
    "",
    "### Question findings",
    "",
    ...(questions.length
      ? questions.map((finding) =>
          `- ${markdown(finding.id)} [${markdown(finding.status)}] at ${markdown(finding.sourceLocation)}: ${markdown(finding.description)}`,
        )
      : ["- None"]),
    "",
    "### Slices with a Question disposition",
    "",
    ...(questionSlices.length
      ? questionSlices.map((slice) => `- ${markdown(slice.id)} at ${markdown(slice.location)}: ${markdown(slice.title)}`)
      : ["- None"]),
    "",
    "## Skipped Sections",
    "",
    `- Skipped slices: ${counts.skippedSlices}`,
    "",
    ...(skipped.length
      ? skipped.map(
          (slice) =>
            `- ${markdown(slice.id)} at ${markdown(slice.location)}: ${markdown(slice.title)} — ${markdown(slice.skippedReason ?? "")}`,
        )
      : ["- None"]),
    "",
    "## Source Manifest",
    "",
    ...sources.map(
      (source) =>
        `- ${markdown(source.id)} — ${markdown(source.path)}: \`${source.hash}\` (${source.hashSource.replaceAll("-", " ")})`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function createFindingsCsv(data: EvidenceExportData): string {
  const slices = new Map(data.slices.map((slice) => [slice.id, slice] as const));
  const header = [
    "findingId",
    "projectId",
    "projectName",
    "revisionId",
    "revisionLabel",
    "sourceSliceId",
    "sourceSection",
    "sourceLocation",
    "type",
    "severity",
    "status",
    "description",
    "createdAt",
    "updatedAt",
    "resolution",
    "externalReference",
    "relatedFindingId",
    "evidenceAttachment",
  ];
  const rows = sortFindings(data.findings).map((finding) => {
    const slice = slices.get(finding.sourceSliceId);
    return [
      finding.id,
      data.project.id,
      data.project.name,
      data.revision.id,
      data.revision.label,
      finding.sourceSliceId,
      slice?.title ?? "",
      finding.sourceLocation,
      finding.type,
      finding.severity ?? "",
      finding.status,
      finding.description,
      finding.createdAt,
      finding.updatedAt ?? "",
      finding.resolution ?? "",
      finding.externalReference ?? "",
      finding.relatedFindingId ?? "",
      finding.evidenceAttachment ?? "",
    ];
  });
  return [header, ...rows].map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n";
}

export function createFindingsJson(data: EvidenceExportData): string {
  const slices = new Map(data.slices.map((slice) => [slice.id, slice] as const));
  const findings = sortFindings(data.findings).map((finding) => ({
    ...finding,
    evidenceAttachment: finding.evidenceAttachment ?? null,
    externalReference: finding.externalReference ?? null,
    relatedFindingId: finding.relatedFindingId ?? null,
    resolution: finding.resolution ?? null,
    severity: finding.severity ?? null,
    sourceSection: slices.get(finding.sourceSliceId)?.title ?? null,
    updatedAt: finding.updatedAt ?? null,
  }));
  return stableJson({
    project: { id: data.project.id, name: data.project.name },
    revision: { id: data.revision.id, label: data.revision.label },
    findings,
  }) + "\n";
}

export function createReviewHistoryJson(data: EvidenceExportData): string {
  const history = [...data.history].sort(
    (left, right) => compare(left.occurredAt, right.occurredAt) || compare(left.id, right.id),
  );
  return stableJson({
    projectId: data.project.id,
    revisionId: data.revision.id,
    reviewDates: data.reviewDates,
    history,
  }) + "\n";
}

export function createSliceManifestJson(data: EvidenceExportData): string {
  const sourcePaths = new Map(data.sources.map((source) => [source.id, source.path] as const));
  const slices = sortSlices(data.slices).map((slice) => ({
    ...slice,
    parentId: slice.parentId ?? null,
    reviewedAt: slice.reviewedAt ?? null,
    skippedReason: slice.skippedReason ?? null,
    sourcePath: sourcePaths.get(slice.sourceId) ?? null,
  }));
  return stableJson({ projectId: data.project.id, revisionId: data.revision.id, slices }) + "\n";
}

export function createSourceManifestJson(data: EvidenceExportData): string {
  return stableJson({
    projectId: data.project.id,
    revisionId: data.revision.id,
    revisionFileHash: data.revision.fileHash?.toLowerCase() ?? null,
    sources: sourceManifest(data.sources),
  }) + "\n";
}

export function sourceManifest(sources: readonly SourceRecord[]) {
  return [...sources]
    .map((source) => ({
      id: source.id,
      path: source.path,
      hash: (source.hash ?? sha256Utf8(source.content ?? "")).toLowerCase(),
      hashSource: source.hash ? "supplied" as const : "calculated-from-content" as const,
    }))
    .sort((left, right) => compare(left.path, right.path) || compare(left.id, right.id));
}

export function sha256Utf8(value: string): string {
  return sha256Bytes(encoder.encode(value));
}

export function sha256Bytes(input: Uint8Array): string {
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bitLength = input.length * 8;
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const s0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const s1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + constants[index] + words[index]) | 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

function enumCounts<const T extends readonly string[]>(values: T): Record<T[number], number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T[number], number>;
}

function countTable(counts: readonly (readonly [string, number])[]): string[] {
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
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compare(left, right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
