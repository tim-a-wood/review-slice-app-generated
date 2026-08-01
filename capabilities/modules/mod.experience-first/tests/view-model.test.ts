import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactSlice } from "../../mod.artifact-processing/src/contracts.ts";
import type { Finding } from "../../mod.findings/src/contracts.ts";
import { getActiveSlice, getMetrics, getSliceRows, labelState, sourceLabel } from "../src/view-model.ts";

const slice = (id: string, reviewState: ArtifactSlice["reviewState"], revisionState: ArtifactSlice["revisionState"]): ArtifactSlice => ({
  id, matchKey: id, artifactId: "artifact", sourceHash: "source", contentHash: id, title: `Section ${id}`, content: "Source text", parentId: null, sequence: Number(id), source: { path: "C:\\review\\guide.md", startOffset: 0, endOffset: 11, startLine: 10, endLine: 12, locator: `Section ${id}` }, preview: { excerpt: "Source", characterCount: 11, lineCount: 1 }, reviewState, revisionState, findingIds: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
});

const finding = (sliceId: string, status: Finding["status"] = "Open"): Finding => ({
  id: "FND-1", type: "Defect", status, description: "Check input limit", source: { artifactId: "artifact", path: "C:\\review\\guide.md", sliceId, location: "Section 1", title: "Section 1" }, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", history: [],
});

test("calculate completion without counting re-review slices", () => {
  const metrics = getMetrics([slice("1", "accepted", "unchanged"), slice("2", "re-review-required", "modified"), slice("3", "skipped", "added")], [finding("1"), finding("2", "Verified")]);
  assert.deepEqual(metrics, { total: 3, complete: 2, remaining: 1, findings: 1, reReview: 1, completionPercent: 67 });
});

test("filter slice rows and preserve source-linked counts", () => {
  const data = { project: { activeSliceId: "2" }, slices: [slice("1", "accepted", "unchanged"), slice("2", "finding", "modified")], findings: [finding("2")], projects: [], importState: { phase: "select", options: {} }, mappings: [], dataPath: "C:\\review" } as never;
  const rows = getSliceRows(data, "section 2", "modified");
  assert.equal(rows.length, 1); assert.equal(rows[0].active, true); assert.equal(rows[0].findingCount, 1);
});

test("use readable states and exact source locations", () => {
  const current = slice("1", "not-reviewed", "unmatched");
  assert.equal(labelState("re-review-required"), "Re Review Required");
  assert.equal(sourceLabel(current), "C:\\review\\guide.md · Section 1");
  assert.equal(getActiveSlice({ project: undefined, slices: [current] } as never)?.id, "1");
});
