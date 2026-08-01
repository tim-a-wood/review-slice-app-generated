import assert from "node:assert/strict";
import test from "node:test";
import { addFinding, applyRevision, completion, decide, openFindings, select } from "../src/model.js";
import type { AppState, RevisionState, Slice } from "../src/types.js";

const counts = (values: Partial<Record<RevisionState, number>>): Record<RevisionState, number> => ({ unchanged: 0, modified: 0, added: 0, removed: 0, relocated: 0, unmatched: 0, ...values });
const slice = (id: string, revisionState: Slice["revisionState"], reviewState: Slice["reviewState"], sequence: number): Slice => ({ id, title: `Section ${id}`, content: `Source ${id}`, location: `guide.md:${sequence}-${sequence}`, sequence, reviewState, revisionState, findingIds: [], matchKey: id, artifactId: "artifact", sourceHash: "source", contentHash: `hash-${id}`, source: { path: "guide.md", startOffset: sequence, endOffset: sequence + 1, startLine: sequence, endLine: sequence, locator: `section:${id}` } });

const state: AppState = {
  projectName: "Test review", dataPath: "C:\\ReviewSlice", activeSliceId: "old-unchanged", updatedAt: "2026-08-01T00:00:00.000Z", hasImportedArtifact: true,
  slices: [slice("old-unchanged", "unchanged", "accepted", 1), slice("old-modified", "unchanged", "finding", 2), slice("old-removed", "unchanged", "skipped", 3), slice("old-relocated", "unchanged", "accepted", 4)],
  findings: [{ id: "FND-1", type: "Defect", description: "The limit needs a unit.", status: "Open", sliceId: "old-unchanged", createdAt: "2026-08-01T00:00:00.000Z" }],
};

test("records a review decision", () => {
  const next = decide(state, "old-modified", "accepted");
  assert.equal(next.slices[1].reviewState, "accepted");
});

test("creates a source-linked finding", () => {
  const next = addFinding(state, "old-modified", "Defect", "The limit needs a unit.");
  assert.equal(next.findings[1].sliceId, "old-modified");
  assert.equal(next.slices[1].findingIds[0], "FND-2");
  assert.equal(openFindings(next.findings), 2);
});

test("moves the active slice", () => { assert.equal(select(state, "old-modified").activeSliceId, "old-modified"); });

test("applies unchanged, modified, added, and removed revision results", () => {
  const unchanged = { ...slice("new-unchanged", "unchanged", "accepted", 1), contentHash: "hash-old-unchanged" };
  const modified = { ...slice("new-modified", "modified", "re-review-required", 2), contentHash: "hash-new-modified" };
  const added = slice("new-added", "added", "not-reviewed", 3);
  const removed = { ...slice("old-removed", "removed", "skipped", 3), contentHash: "hash-old-removed" };
  const relocated = { ...slice("new-relocated", "relocated", "accepted", 4), contentHash: "hash-old-relocated" };
  const unmatched = slice("new-unmatched", "unmatched", "not-reviewed", 5);
  const next = applyRevision(state, { current: [unchanged, modified, added, relocated, unmatched], removed: [removed], mappings: [
    { previousSliceId: "old-unchanged", currentSliceId: "new-unchanged", revisionState: "unchanged" },
    { previousSliceId: "old-modified", currentSliceId: "new-modified", revisionState: "modified" },
    { previousSliceId: "old-relocated", currentSliceId: "new-relocated", revisionState: "relocated" },
  ], counts: counts({ unchanged: 1, modified: 1, added: 1, removed: 1, relocated: 1, unmatched: 1 }) }, "2026-08-02T00:00:00.000Z");
  assert.deepEqual(next.slices.map((item) => item.revisionState), ["unchanged", "modified", "added", "removed", "relocated", "unmatched"]);
  assert.equal(next.slices.find((item) => item.id === "new-unchanged")?.reviewState, "accepted");
  assert.equal(next.slices.find((item) => item.id === "new-modified")?.reviewState, "re-review-required");
  assert.equal(next.slices.find((item) => item.id === "new-added")?.reviewState, "re-review-required");
  assert.equal(next.slices.find((item) => item.id === "new-relocated")?.reviewState, "accepted");
  assert.equal(next.slices.find((item) => item.id === "new-unmatched")?.reviewState, "re-review-required");
  assert.equal(next.slices.find((item) => item.id === "old-removed")?.reviewState, "skipped");
  assert.equal(next.revision?.counts.removed, 1);
});

test("preserves decisions, findings, completion, and source links", () => {
  const current = { ...slice("new-unchanged", "unchanged", "accepted", 1), contentHash: "hash-old-unchanged" };
  const next = applyRevision(state, { current: [current], removed: [], mappings: [{ previousSliceId: "old-unchanged", currentSliceId: "new-unchanged", revisionState: "unchanged" }], counts: counts({ unchanged: 1 }) }, "2026-08-02T00:00:00.000Z");
  assert.equal(next.findings[0].sliceId, "new-unchanged");
  assert.equal(next.slices[0].findingIds[0], "FND-1");
  assert.equal(next.slices[0].priorReviewState, "accepted");
  assert.equal(next.slices[0].source?.path, "guide.md");
  assert.equal(next.slices[0].source?.locator, "section:new-unchanged");
  assert.equal(completion(next.slices), 100);
});
