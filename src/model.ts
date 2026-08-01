import type { AppState, Finding, ReviewState, RevisionState, RevisionSummary, Slice } from "./types.js";

export interface RevisionMapping { previousSliceId: string; currentSliceId: string; revisionState: RevisionState; }
export interface RevisionResult { current: readonly Slice[]; removed: readonly Slice[]; mappings: readonly RevisionMapping[]; counts: Record<RevisionState, number>; }

export function reviewedCount(slices: readonly Slice[]): number {
  return slices.filter((slice) => slice.revisionState !== "removed" && slice.reviewState !== "not-reviewed" && slice.reviewState !== "re-review-required").length;
}

export function completion(slices: readonly Slice[]): number {
  const reviewable = slices.filter((slice) => slice.revisionState !== "removed");
  return reviewable.length ? Math.round((reviewedCount(reviewable) / reviewable.length) * 100) : 0;
}

export function openFindings(findings: readonly Finding[]): number {
  return findings.filter((finding) => finding.status === "Open" || finding.status === "Addressed").length;
}

export function activeSlice(state: AppState): Slice {
  return state.slices.find((slice) => slice.id === state.activeSliceId) ?? state.slices.find((slice) => slice.revisionState !== "removed") ?? state.slices[0];
}

export function decide(state: AppState, id: string, reviewState: ReviewState, reason = ""): AppState {
  const slices = state.slices.map((slice) => slice.id === id ? { ...slice, reviewState, skipReason: reviewState === "skipped" ? reason.trim() : undefined } : slice);
  return touch({ ...state, slices });
}

export function addFinding(state: AppState, id: string, type: Finding["type"], description: string): AppState {
  const text = description.trim();
  if (!text) throw new Error("Enter a finding description.");
  const finding: Finding = { id: `FND-${state.findings.length + 1}`, type, description: text, status: "Open", sliceId: id, createdAt: new Date().toISOString() };
  const reviewState: ReviewState = type === "Question" ? "question" : "finding";
  const slices = state.slices.map((slice) => slice.id === id ? { ...slice, reviewState, findingIds: [...slice.findingIds, finding.id] } : slice);
  return touch({ ...state, slices, findings: [...state.findings, finding] });
}

export function select(state: AppState, id: string): AppState { return touch({ ...state, activeSliceId: id }); }

export function applyRevision(state: AppState, result: RevisionResult, importedAt: string): AppState {
  const mappings = new Map(result.mappings.map((mapping) => [mapping.previousSliceId, mapping]));
  const prior = new Map(state.slices.map((slice) => [slice.id, slice]));
  const findings = state.findings.map((finding) => ({ ...finding, sliceId: mappings.get(finding.sliceId)?.currentSliceId ?? finding.sliceId }));
  const current = result.current.map((slice) => {
    const mapping = result.mappings.find((item) => item.currentSliceId === slice.id);
    const previous = mapping ? prior.get(mapping.previousSliceId) : undefined;
    const reviewState = slice.revisionState === "added" || slice.revisionState === "unmatched" ? "re-review-required" : slice.reviewState;
    return { ...slice, reviewState, priorReviewState: previous?.reviewState, findingIds: findings.filter((finding) => finding.sliceId === slice.id).map((finding) => finding.id) };
  });
  const removed = result.removed.map((slice) => ({ ...slice, revisionState: "removed" as const, priorReviewState: slice.reviewState, findingIds: findings.filter((finding) => finding.sliceId === slice.id).map((finding) => finding.id) }));
  const active = mappings.get(state.activeSliceId)?.currentSliceId ?? current.find((slice) => slice.revisionState !== "removed")?.id ?? removed[0]?.id ?? "";
  const revision: RevisionSummary = { importedAt, counts: result.counts, previousProjectName: state.projectName };
  return touch({ ...state, slices: [...current, ...removed].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)), findings, activeSliceId: active, hasImportedArtifact: true, revision });
}

export function touch(state: AppState): AppState { return { ...state, updatedAt: new Date().toISOString() }; }
export function label(value: string): string { return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
