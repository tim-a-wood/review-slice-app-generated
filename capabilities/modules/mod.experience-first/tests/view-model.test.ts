import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedFinding, ReviewSlice, WorkspaceView } from "../src/contracts.ts";
import { compareLines, label, metrics, reviewUnitSliceIds, sourceLabel, visibleSlices } from "../src/view-model.ts";

const at = "2026-08-01T00:00:00.000Z";

function slice(
  id: string,
  reviewState: ReviewSlice["reviewState"],
  revisionState: ReviewSlice["revisionState"],
): ReviewSlice {
  return {
    id,
    revisionId: "revision-b",
    stableMatchKey: `requirement:${id}`,
    title: `Section ${id}`,
    content: "Source text",
    contentHash: `hash-${id}`,
    sequence: Number(id),
    source: {
      artifactId: "artifact-b",
      path: "C:\\review\\guide.md",
      location: `Lines ${id}0-${id}2`,
      locator: `Section ${id}`,
    },
    reviewState,
    revisionState,
    notes: [],
    createdAt: at,
    updatedAt: at,
  };
}

function finding(sliceId: string, status: ManagedFinding["status"] = "Open"): ManagedFinding {
  return {
    id: `FND-${sliceId}`,
    type: "Defect",
    status,
    description: "Check the input limit.",
    source: {
      projectId: "project",
      revisionId: "revision-b",
      artifactId: "artifact-b",
      sliceId,
      path: "C:\\review\\guide.md",
      location: `Section ${sliceId}`,
      title: `Section ${sliceId}`,
    },
    createdAt: at,
    updatedAt: at,
    evidenceAttachments: [],
    verifications: [],
    history: [],
  };
}

test("completion excludes removed content and keeps re-review work open", () => {
  const result = metrics([
    slice("1", "accepted", "unchanged"),
    slice("2", "re-review-required", "modified"),
    slice("3", "skipped", "added"),
    slice("4", "accepted", "removed"),
  ], [finding("1"), finding("2", "Verified")]);

  assert.deepEqual(result, {
    total: 3,
    reviewed: 2,
    remaining: 1,
    completionPercent: 67,
    openFindings: 1,
    reReview: 1,
  });
});

test("labels and source links remain readable and exact", () => {
  const current = slice("1", "not-reviewed", "unmatched");
  assert.equal(label("re-review-required"), "Re Review Required");
  assert.equal(sourceLabel(current), "C:\\review\\guide.md · Section 1");
});

test("line comparison is deterministic", () => {
  assert.deepEqual(compareLines("alpha\nbeta", "alpha\ngamma"), [
    { kind: "same", text: "alpha", oldLine: 1, newLine: 1 },
    { kind: "removed", text: "beta", oldLine: 2 },
    { kind: "added", text: "gamma", newLine: 2 },
  ]);
});

test("the review queue excludes removed tombstones while the revision manifest retains them", () => {
  const current = slice("1", "not-reviewed", "added");
  const removed = slice("2", "accepted", "removed");
  const view = { slices: [current, removed], query: "", filter: "all" } as WorkspaceView;
  assert.deepEqual(visibleSlices(view).map((item) => item.id), [current.id]);
});

test("manual mapping ancestry keeps earlier findings linked after a stable key changes", () => {
  const first = slice("1", "finding", "added");
  const second = { ...slice("2", "re-review-required", "modified"), stableMatchKey: "renamed-unit", previousSliceId: first.id };
  const third = { ...slice("3", "accepted", "unchanged"), stableMatchKey: "renamed-unit", previousSliceId: second.id };
  const project = {
    id: "project",
    name: "Review",
    archived: false,
    createdAt: at,
    updatedAt: at,
    lastOpenedAt: at,
    activeRevisionId: "revision-b",
    revisions: [
      { id: "revision-a", label: "A", fileName: "a.md", fileHash: "a", artifactType: "markdown", parserVersion: "1", importedAt: at, slices: [first] },
      { id: "revision-b", label: "B", fileName: "b.md", fileHash: "b", artifactType: "markdown", parserVersion: "1", importedAt: at, slices: [second] },
      { id: "revision-c", label: "C", fileName: "c.md", fileHash: "c", artifactType: "markdown", parserVersion: "1", importedAt: at, slices: [third] },
    ],
    decisions: [],
    history: [],
  } as const;
  assert.equal(reviewUnitSliceIds(project, third).has(first.id), true);
});
