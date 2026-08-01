import type { AppState } from "./types.js";

export function createDemo(dataPath: string): AppState {
  const now = "2026-08-01T12:00:00.000Z";
  return {
    projectName: "Flight Control Requirements Review", dataPath, activeSliceId: "slice-2", updatedAt: now, hasImportedArtifact: false,
    slices: [
      { id: "slice-1", title: "Purpose", content: "This specification defines the flight control review limits.", location: "PRD.md:1-6", sequence: 1, reviewState: "accepted", revisionState: "unchanged", findingIds: [] },
      { id: "slice-2", title: "Control limits", content: "The application shall show the commanded limit in degrees and retain the source link.", location: "PRD.md:7-15", sequence: 2, reviewState: "finding", revisionState: "modified", findingIds: ["FND-1"], note: "Check the unit before release." },
      { id: "slice-3", title: "Review states", content: "Each slice has one review state and one revision state.", location: "PRD.md:16-25", sequence: 3, reviewState: "not-reviewed", revisionState: "added", findingIds: [] },
      { id: "slice-4", title: "Evidence output", content: "The evidence ZIP contains the review summary and source manifests.", location: "PRD.md:26-33", sequence: 4, reviewState: "question", revisionState: "relocated", findingIds: ["FND-2"] },
      { id: "slice-5", title: "Recovery", content: "The local store writes a primary file and a recoverable backup.", location: "PRD.md:34-39", sequence: 5, reviewState: "skipped", revisionState: "unchanged", findingIds: [], skipReason: "Not in this review baseline." },
    ],
    findings: [
      { id: "FND-1", type: "Defect", description: "The commanded limit has no unit in the source text.", status: "Open", sliceId: "slice-2", createdAt: now },
      { id: "FND-2", type: "Question", description: "Confirm the evidence retention period.", status: "Addressed", sliceId: "slice-4", createdAt: now },
    ],
  };
}
