import type { ArtifactSlice, ReviewState, RevisionState } from "../../mod.artifact-processing/src/contracts.ts";
import type { Finding } from "../../mod.findings/src/contracts.ts";
import type { WorkspaceData } from "./contracts.ts";

export interface ReviewMetrics { total: number; complete: number; remaining: number; findings: number; reReview: number; completionPercent: number; }
export interface SliceRow { slice: ArtifactSlice; findingCount: number; active: boolean; }

export function getMetrics(slices: readonly ArtifactSlice[], findings: readonly Finding[]): ReviewMetrics {
  const complete = slices.filter((slice) => slice.reviewState !== "not-reviewed" && slice.reviewState !== "re-review-required").length;
  return { total: slices.length, complete, remaining: slices.length - complete, findings: findings.filter((item) => item.status === "Open").length, reReview: slices.filter((slice) => slice.reviewState === "re-review-required").length, completionPercent: slices.length ? Math.round((complete / slices.length) * 100) : 0 };
}

export function getActiveSlice(data: WorkspaceData): ArtifactSlice | undefined {
  return data.slices.find((slice) => slice.id === data.project?.activeSliceId) ?? data.slices[0];
}

export function getSliceRows(data: WorkspaceData, query = "", filter = "all"): SliceRow[] {
  const terms = query.trim().toLowerCase(); const active = getActiveSlice(data)?.id;
  return data.slices.filter((slice) => {
    const text = `${slice.title} ${slice.source.path} ${slice.source.locator ?? ""}`.toLowerCase();
    return (!terms || text.includes(terms)) && (filter === "all" || slice.reviewState === filter || slice.revisionState === filter);
  }).map((slice) => ({ slice, active: slice.id === active, findingCount: data.findings.filter((finding) => finding.source.sliceId === slice.id).length }));
}

export function labelState(state: ReviewState | RevisionState): string {
  return state.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export function formatDate(value?: string): string {
  if (!value) return "Not saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function sourceLabel(slice: ArtifactSlice): string {
  return `${slice.source.path} · ${slice.source.locator ?? `Lines ${slice.source.startLine}-${slice.source.endLine}`}`;
}
