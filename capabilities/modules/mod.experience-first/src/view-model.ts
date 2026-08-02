import type { ManagedFinding, ReviewProject, ReviewSlice, WorkspaceView } from "./contracts.ts";
import type { AppState, Finding, ReviewState, RevisionResult, Slice } from "./contracts.ts";

export interface ReviewMetrics {
  total: number;
  reviewed: number;
  remaining: number;
  completionPercent: number;
  openFindings: number;
  reReview: number;
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function metrics(slices: readonly ReviewSlice[], findings: readonly ManagedFinding[]): ReviewMetrics {
  const reviewable = slices.filter((slice) => slice.revisionState !== "removed");
  const reviewed = reviewable.filter((slice) => slice.reviewState !== "not-reviewed" && slice.reviewState !== "re-review-required").length;
  return {
    total: reviewable.length,
    reviewed,
    remaining: reviewable.length - reviewed,
    completionPercent: reviewable.length ? Math.round((reviewed / reviewable.length) * 100) : 0,
    openFindings: findings.filter((finding) => finding.status === "Open" || finding.status === "Addressed").length,
    reReview: reviewable.filter((slice) => slice.reviewState === "re-review-required").length,
  };
}

export function projectProgress(project: ReviewProject, findings: readonly ManagedFinding[]): ReviewMetrics {
  const revision = project.revisions.find((item) => item.id === project.activeRevisionId) ?? project.revisions.at(-1);
  return metrics(revision?.slices ?? [], findings.filter((finding) => finding.source.projectId === project.id));
}

export function visibleSlices(view: WorkspaceView): ReviewSlice[] {
  const query = view.query.trim().toLocaleLowerCase();
  return view.slices.filter((slice) => {
    if (slice.revisionState === "removed") return false;
    const source = `${slice.source.path} ${slice.source.location} ${slice.source.locator ?? ""}`.toLocaleLowerCase();
    const textMatches = !query || `${slice.title} ${source}`.toLocaleLowerCase().includes(query);
    if (!textMatches) return false;
    if (view.filter === "all") return true;
    if (view.filter === "changed") return ["modified", "added", "relocated", "unmatched"].includes(slice.revisionState);
    return slice.reviewState === view.filter || slice.revisionState === view.filter;
  });
}

export function label(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

export function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function sourceLabel(slice: ReviewSlice): string {
  return `${slice.source.path} · ${slice.source.locator ?? slice.source.location}`;
}

/** Resolve every historical slice ID that represents the same review unit. */
export function reviewUnitSliceIds(project: ReviewProject, slice: ReviewSlice): Set<string> {
  const allSlices = project.revisions.flatMap((revision) => revision.slices);
  const byId = new Map(allSlices.map((item) => [item.id, item]));
  const ids = new Set(
    allSlices
      .filter((item) => item.stableMatchKey === slice.stableMatchKey)
      .map((item) => item.id),
  );
  const visited = new Set<string>();
  let current: ReviewSlice | undefined = slice;
  while (current?.previousSliceId && !visited.has(current.previousSliceId)) {
    visited.add(current.previousSliceId);
    ids.add(current.previousSliceId);
    current = byId.get(current.previousSliceId);
  }
  ids.add(slice.id);
  return ids;
}

/** A deterministic line comparison for the read-only review surface. */
export function compareLines(previous = "", current = ""): DiffLine[] {
  const before = previous.split("\n");
  const after = current.split("\n");
  const rows = before.length + 1;
  const columns = after.length + 1;
  const lengths = new Uint32Array(rows * columns);
  const cell = (row: number, column: number): number => row * columns + column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      lengths[cell(row, column)] = before[row - 1] === after[column - 1]
        ? lengths[cell(row - 1, column - 1)] + 1
        : Math.max(lengths[cell(row - 1, column)], lengths[cell(row, column - 1)]);
    }
  }
  const result: DiffLine[] = [];
  let row = before.length;
  let column = after.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && before[row - 1] === after[column - 1]) {
      result.push({ kind: "same", text: before[row - 1], oldLine: row, newLine: column });
      row -= 1;
      column -= 1;
    } else if (column > 0 && (row === 0 || lengths[cell(row, column - 1)] >= lengths[cell(row - 1, column)])) {
      result.push({ kind: "added", text: after[column - 1], newLine: column });
      column -= 1;
    } else {
      result.push({ kind: "removed", text: before[row - 1], oldLine: row });
      row -= 1;
    }
  }
  return result.reverse();
}

// Compatibility projections for the unchanged deployable verification suite. The provider
// modules remain authoritative in the mounted workspace; these functions adapt old fixtures.
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
  return state.slices.find((slice) => slice.id === state.activeSliceId)
    ?? state.slices.find((slice) => slice.revisionState !== "removed")
    ?? state.slices[0];
}

export function decide(state: AppState, id: string, reviewState: ReviewState, reason = ""): AppState {
  const slices = state.slices.map((slice) => slice.id === id
    ? { ...slice, reviewState, skipReason: reviewState === "skipped" ? reason.trim() : undefined }
    : slice);
  return touch({ ...state, slices });
}

export function addFinding(state: AppState, id: string, type: Finding["type"], description: string): AppState {
  const text = description.trim();
  if (!text) throw new Error("Enter a finding description.");
  const finding: Finding = {
    id: `FND-${state.findings.length + 1}`,
    type,
    description: text,
    status: "Open",
    sliceId: id,
    createdAt: new Date().toISOString(),
  };
  const reviewState: ReviewState = type === "Question" ? "question" : "finding";
  const slices = state.slices.map((slice) => slice.id === id
    ? { ...slice, reviewState, findingIds: [...slice.findingIds, finding.id] }
    : slice);
  return touch({ ...state, slices, findings: [...state.findings, finding] });
}

export function select(state: AppState, id: string): AppState {
  return touch({ ...state, activeSliceId: id });
}

export function applyRevision(state: AppState, result: RevisionResult, importedAt: string): AppState {
  const mappings = new Map(result.mappings.map((mapping) => [mapping.previousSliceId, mapping]));
  const prior = new Map(state.slices.map((slice) => [slice.id, slice]));
  const findings = state.findings.map((finding) => ({ ...finding, sliceId: mappings.get(finding.sliceId)?.currentSliceId ?? finding.sliceId }));
  const current = result.current.map((slice) => {
    const mapping = result.mappings.find((item) => item.currentSliceId === slice.id);
    const previous = mapping ? prior.get(mapping.previousSliceId) : undefined;
    const reviewState: ReviewState = slice.revisionState === "modified" || slice.revisionState === "added" || slice.revisionState === "unmatched"
      ? "re-review-required"
      : previous?.reviewState ?? slice.reviewState;
    return {
      ...slice,
      reviewState,
      priorReviewState: previous?.reviewState,
      findingIds: findings.filter((finding) => finding.sliceId === slice.id).map((finding) => finding.id),
    };
  });
  const removed = result.removed.map((slice) => ({
    ...slice,
    revisionState: "removed" as const,
    priorReviewState: slice.reviewState,
    findingIds: findings.filter((finding) => finding.sliceId === slice.id).map((finding) => finding.id),
  }));
  const active = mappings.get(state.activeSliceId)?.currentSliceId
    ?? current.find((slice) => slice.revisionState !== "removed")?.id
    ?? removed[0]?.id
    ?? "";
  return touch({
    ...state,
    slices: [...current, ...removed].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    findings,
    activeSliceId: active,
    hasImportedArtifact: true,
    revision: { importedAt, counts: result.counts, previousProjectName: state.projectName },
  });
}

export function touch(state: AppState): AppState {
  return { ...state, updatedAt: new Date().toISOString() };
}
