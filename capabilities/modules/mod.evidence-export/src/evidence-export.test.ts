import assert from "node:assert/strict";
import test from "node:test";
import { createEvidencePackage, createFindingsRegister } from "./evidence-export.ts";
import type { EvidenceExportData } from "./contracts.ts";

const data: EvidenceExportData = {
  project: { id: "project-1", name: "Review Slice", dataLocation: "C:\\ReviewSlice\\project-1" },
  revision: { id: "rev-2", label: "Revision 2", importedAt: "2026-07-30T12:00:00.000Z" },
  reviewDates: { startedAt: "2026-07-29T08:00:00.000Z", exportedAt: "2026-08-01T02:00:00.000Z" },
  sources: [
    { id: "source-b", path: "docs/B.md", content: "B" },
    { id: "source-a", path: "docs/A.md", content: "A\nΔ" },
  ],
  slices: [
    { id: "slice-2", matchKey: "b", sourceId: "source-b", location: "2", title: "Skipped topic", sequence: 2, reviewState: "Skipped", revisionState: "Modified", contentHash: "hash-b", skippedReason: "Out of scope" },
    { id: "slice-1", matchKey: "a", sourceId: "source-a", location: "1", title: "Question topic", sequence: 1, reviewState: "Question", revisionState: "Unchanged", contentHash: "hash-a" },
  ],
  findings: [
    { id: "F-2", type: "Defect", description: "Second finding", status: "Open", sourceSliceId: "slice-2", sourceLocation: "2", createdAt: "2026-07-30T10:00:00.000Z" },
    { id: "F-1", type: "Question", description: "First, quoted \"finding\"", status: "Addressed", sourceSliceId: "slice-1", sourceLocation: "1", createdAt: "2026-07-29T10:00:00.000Z" },
  ],
  history: [
    { id: "history-2", occurredAt: "2026-07-30T10:00:00.000Z", action: "Skip slice", sliceId: "slice-2" },
    { id: "history-1", occurredAt: "2026-07-29T10:00:00.000Z", action: "Add question", sliceId: "slice-1" },
  ],
};

test("createEvidencePackage creates deterministic required files", () => {
  const first = createEvidencePackage(data);
  const second = createEvidencePackage(data);
  assert.deepEqual(first.zip, second.zip);
  assert.deepEqual(first.files.map((file) => file.name), [
    "review-summary.md", "findings.csv", "review-history.json", "slice-manifest.json", "source-manifest.json",
  ]);
  const summary = text(first.files[0].content);
  assert.match(summary, /Completion: 100.00%/);
  assert.match(summary, /Question topic/);
  assert.match(summary, /Out of scope/);
  assert.match(summary, /Source Hashes/);
  assert.deepEqual(zipNames(first.zip), first.files.map((file) => file.name));
});

test("createFindingsRegister escapes CSV values and sorts JSON records", () => {
  const csv = text(createFindingsRegister(data, "csv"));
  const json = text(createFindingsRegister(data, "json"));
  assert.match(csv, /"First, quoted ""finding"""/);
  assert.ok(csv.indexOf("F-1") < csv.indexOf("F-2"));
  assert.ok(json.indexOf("F-1") < json.indexOf("F-2"));
});

test("createEvidencePackage rejects skipped slices without reasons", () => {
  const invalid = { ...data, slices: [{ ...data.slices[0], skippedReason: "" }, data.slices[1]] };
  assert.throws(() => createEvidencePackage(invalid), /requires a reason/);
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
