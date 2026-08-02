import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceArtifacts, createEvidenceExport, createEvidencePackage, createFindingsRegister } from "./evidence-export.ts";
import { sha256Utf8 } from "./serialize.ts";
import { EvidenceValidationError } from "./validation.ts";
import type { EvidenceExportData } from "./contracts.ts";

const data: EvidenceExportData = {
  project: {
    id: "project-1",
    name: "Review Slice",
    description: "Engineering review",
    artifactType: "Markdown",
    dataLocation: "C:\\ReviewSlice\\project-1",
  },
  revision: {
    id: "rev-2",
    label: "Revision B",
    fileName: "requirements.md",
    fileHash: sha256Utf8("A\nB\nC"),
    parserVersion: "1.0.0",
    importedAt: "2026-07-30T12:00:00.000Z",
  },
  reviewDates: {
    startedAt: "2026-07-29T08:00:00.000Z",
    completedAt: "2026-08-01T01:00:00.000Z",
    exportedAt: "2026-08-01T02:00:00.000Z",
  },
  sources: [
    { id: "source-b", path: "docs/B.md", content: "B" },
    { id: "source-a", path: "docs/A.md", content: "A\nΔ" },
  ],
  slices: [
    {
      id: "slice-2", matchKey: "b", sourceId: "source-b", location: "line 2", title: "Skipped topic", sequence: 2,
      reviewState: "Skipped", revisionState: "Modified", contentHash: sha256Utf8("B"), skippedReason: "Out of scope",
      reviewedAt: "2026-07-30T10:00:00.000Z",
    },
    {
      id: "slice-1", matchKey: "a", sourceId: "source-a", location: "line 1", title: "Question topic", sequence: 1,
      reviewState: "Question", revisionState: "Unchanged", contentHash: sha256Utf8("A"),
      reviewedAt: "2026-07-29T10:00:00.000Z",
    },
    {
      id: "slice-3", matchKey: "c", sourceId: "source-a", location: "line 3", title: "Removed topic", sequence: 3,
      reviewState: "Re-review Required", revisionState: "Removed", contentHash: sha256Utf8("C"),
    },
  ],
  findings: [
    {
      id: "F-2", type: "Defect", description: "Second finding", status: "Open", sourceSliceId: "slice-2",
      sourceLocation: "line 2", createdAt: "2026-07-30T10:00:00.000Z", severity: "Major",
    },
    {
      id: "F-1", type: "Question", description: "First, quoted \"finding\"\nwith detail", status: "Addressed",
      sourceSliceId: "slice-1", sourceLocation: "line 1, column 4", createdAt: "2026-07-29T10:00:00.000Z",
    },
  ],
  history: [
    { id: "history-2", occurredAt: "2026-07-30T10:00:00.000Z", action: "Skip slice", sliceId: "slice-2" },
    { id: "history-1", occurredAt: "2026-07-29T10:00:00.000Z", action: "Add question", sliceId: "slice-1", findingId: "F-1" },
  ],
};

test("createEvidenceExport returns deterministic standalone downloads and a complete evidence ZIP", () => {
  const provider = createEvidenceExport();
  const first = provider.execute(data);
  const second = provider.exportEvidence(data);
  assert.deepEqual(first, second);
  assert.deepEqual(first.downloads.map((item) => item.name), [
    "review-summary.md", "findings.csv", "findings.json", "review-history.json", "slice-manifest.json",
    "source-manifest.json", "review-evidence.zip",
  ]);
  assert.deepEqual(first.evidencePackage.files.map((file) => file.name), [
    "review-summary.md", "findings.csv", "review-history.json", "slice-manifest.json", "source-manifest.json",
  ]);
  assert.deepEqual(zipNames(first.evidencePackage.zip), first.evidencePackage.files.map((file) => file.name));
  assert.equal(first.counts.reviewableSlices, 2);
  assert.equal(first.counts.reviewedSlices, 2);
  assert.equal(first.counts.completionPercent, 100);
  assert.equal(first.counts.questionSlices, 1);
  assert.equal(first.counts.unresolvedQuestionFindings, 1);
  assert.equal(first.counts.skippedSlices, 1);
});

test("summary and manifests preserve supplied state, locations, history, and real hashes", () => {
  const packageResult = createEvidencePackage(data);
  const summary = text(packageResult.files[0].content);
  const history = text(packageResult.files[2].content);
  const slices = text(packageResult.files[3].content);
  const sources = text(packageResult.files[4].content);
  assert.match(summary, /Remaining slices: 0/);
  assert.match(summary, /\| Modified \| 1 \|/);
  assert.match(summary, /line 1, column 4/);
  assert.match(summary, /Out of scope/);
  assert.ok(history.indexOf("history-1") < history.indexOf("history-2"));
  assert.match(slices, /"sourcePath": "docs\/A.md"/);
  assert.match(sources, /"hashSource": "calculated-from-content"/);
});

test("findings CSV is RFC 4180 and findings JSON is stable", () => {
  const csv = text(createFindingsRegister(data, "csv"));
  const json = text(createFindingsRegister(data, "json"));
  assert.ok(csv.endsWith("\r\n"));
  assert.match(csv, /"First, quoted ""finding""\nwith detail"/);
  assert.ok(csv.indexOf("F-1") < csv.indexOf("F-2"));
  assert.ok(json.indexOf("F-1") < json.indexOf("F-2"));
  assert.match(json, /"sourceLocation": "line 1, column 4"/);
});

test("invalid state returns stable, traceable diagnostics and no partial export", () => {
  const invalid: EvidenceExportData = {
    ...data,
    project: { ...data.project, dataLocation: "https://example.invalid/review" },
    slices: [{ ...data.slices[0], skippedReason: "", contentHash: "not-a-hash" }, ...data.slices.slice(1)],
    findings: [{ ...data.findings[0], sourceSliceId: "missing" }, ...data.findings.slice(1)],
  };
  assert.throws(
    () => createEvidenceArtifacts(invalid),
    (error) => error instanceof EvidenceValidationError
      && error.diagnostics.some((item) => item.code === "EVIDENCE_LOCAL_ONLY")
      && error.diagnostics.some((item) => item.code === "EVIDENCE_SKIP_REASON")
      && error.diagnostics.some((item) => item.code === "EVIDENCE_SHA256")
      && error.diagnostics.some((item) => item.code === "EVIDENCE_UNKNOWN_SLICE"),
  );
});

function zipNames(zip: Uint8Array): string[] {
  const names: string[] = [];
  let offset = 0;
  while (read32(zip, offset) === 0x04034b50) {
    const nameLength = read16(zip, offset + 26);
    const contentLength = read32(zip, offset + 18);
    names.push(text(zip.slice(offset + 30, offset + 30 + nameLength)));
    offset += 30 + nameLength + contentLength;
  }
  return names;
}

function read16(value: Uint8Array, offset: number): number {
  return value[offset] | (value[offset + 1] << 8);
}

function read32(value: Uint8Array, offset: number): number {
  return (read16(value, offset) | (read16(value, offset + 2) << 16)) >>> 0;
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
