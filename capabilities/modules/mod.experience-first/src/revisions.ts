import type { RevisionState, WorkspaceView } from "./contracts.ts";
import { attribute, escapeHtml, icon, pageHeading } from "./dom.ts";
import { formatDate, label, sourceLabel } from "./view-model.ts";

const revisionStates: readonly RevisionState[] = ["unchanged", "modified", "added", "removed", "relocated", "unmatched"];

export function renderRevisions(view: WorkspaceView): string {
  if (!view.project) return noRevision("Open a review project to inspect its revisions.");
  const counts = Object.fromEntries(revisionStates.map((state) => [state, view.slices.filter((slice) => slice.revisionState === state).length])) as Record<RevisionState, number>;
  return `<section class="eui-page revision-page" data-view="revisions" aria-labelledby="revision-title">
    ${pageHeading({ id: "revision-title", eyebrow: "Revision comparison", title: `${view.previousRevisionLabel ?? "Previous revision"} to ${view.revisionLabel ?? "Current revision"}`, summary: "Unchanged and relocated slices retain prior dispositions. Changed content returns to the review queue.", actions: `<button class="eui-button secondary" type="button" data-action="open-mappings">${icon("git-compare")}Review mappings</button><button class="eui-button primary" type="button" data-action="start-revision">${icon("plus")}Import revision</button>` })}
    <section class="change-summary" aria-label="Revision change counts">${revisionStates.map((state) => `<button type="button" data-action="review-revision-state" data-filter="${state}" class="change-cell ${state}"><span>${label(state)}</span><strong>${counts[state]}</strong><small>${description(state)}</small></button>`).join("")}</section>
    <section class="eui-panel revision-table-panel" aria-labelledby="change-table-title"><div class="panel-heading"><div><p class="eyebrow">Slice manifest</p><h2 id="change-table-title">Change classification</h2></div><span class="record-count">Imported ${escapeHtml(formatDate(view.comparison?.importedAt ?? view.project.updatedAt))}</span></div>
      <div class="table-scroll"><table class="eui-table"><thead><tr><th>Current slice</th><th>Source location</th><th>Revision state</th><th>Review state</th><th>Prior disposition</th></tr></thead><tbody>${view.slices.map((slice) => `<tr><td><button class="record-link plain" type="button" data-action="select-slice" data-slice-id="${attribute(slice.id)}"><strong>${escapeHtml(slice.title)}</strong><small class="mono">${escapeHtml(slice.stableMatchKey)}</small></button></td><td><code>${escapeHtml(sourceLabel(slice))}</code></td><td><span class="status-chip ${tone(slice.revisionState)}">${label(slice.revisionState)}</span></td><td>${label(slice.reviewState)}</td><td>${slice.previousReviewState ? label(slice.previousReviewState) : "Not available"}</td></tr>`).join("")}</tbody></table></div>
    </section>
    <div class="retention-note">${icon("shield-check")}<span><strong>Decision retention is deterministic.</strong> Only unchanged or relocated equivalent content keeps its prior decision.</span><button class="eui-link" type="button" data-action="open-changed">Open changed queue</button></div>
  </section>`;
}

export function renderMappings(view: WorkspaceView): string {
  const candidates = view.comparison?.comparison.uncertainCandidates ?? [];
  return `<section class="eui-page mapping-page" data-view="mappings" aria-labelledby="mapping-title">
    ${pageHeading({ id: "mapping-title", eyebrow: "Manual correction", title: "Uncertain mappings", summary: "Confirm a source relationship only when the content represents the same review unit.", actions: `<button class="eui-button secondary" type="button" data-action="open-revisions">${icon("arrow-left")}Back to comparison</button>` })}
    <div class="mapping-status"><span>${icon("shield-check")}Reviewer-confirmed mappings are retained with the revision evidence.</span><strong>${candidates.length} require attention</strong></div>
    ${candidates.length ? `<div class="mapping-list">${candidates.map((candidate) => {
      const previous = view.comparison?.comparison.previous.find((slice) => slice.id === candidate.previousSliceId);
      const current = view.comparison?.comparison.current.find((slice) => slice.id === candidate.currentSliceId);
      return `<article class="eui-panel mapping-record"><div class="mapping-confidence"><span>Match confidence</span><strong>${Math.round(candidate.confidence * 100)}%</strong><small>${escapeHtml(label(candidate.reason))}</small></div><div class="mapping-side"><p class="eyebrow">Previous</p><h2>${escapeHtml(previous?.title ?? candidate.previousSliceId)}</h2><code>${previous ? escapeHtml(previous.source.locator ?? previous.source.path) : "Source not available"}</code><p>${escapeHtml(previous?.preview.excerpt ?? "The prior slice is not available.")}</p></div><div class="mapping-arrow">${icon("arrow-right")}</div><div class="mapping-side"><p class="eyebrow">Current</p><h2>${escapeHtml(current?.title ?? candidate.currentSliceId)}</h2><code>${current ? escapeHtml(current.source.locator ?? current.source.path) : "Source not available"}</code><p>${escapeHtml(current?.preview.excerpt ?? "The current slice is not available.")}</p></div><div class="mapping-actions"><button class="eui-button secondary" type="button" data-action="reject-mapping" data-previous-id="${attribute(candidate.previousSliceId)}" data-current-id="${attribute(candidate.currentSliceId)}">Keep unmatched</button><button class="eui-button primary" type="button" data-action="confirm-mapping" data-previous-id="${attribute(candidate.previousSliceId)}" data-current-id="${attribute(candidate.currentSliceId)}">${icon("check")}Confirm mapping</button></div></article>`;
    }).join("")}</div>` : `<section class="eui-panel empty-state">${icon("shield-check")}<h2>All mappings are resolved</h2><p>No uncertain source relationships require reviewer action.</p><button class="eui-button primary" type="button" data-action="${view.importDraft.mode === "revision" && view.importDraft.result ? "finalize-revision-import" : "open-review"}">${view.importDraft.mode === "revision" && view.importDraft.result ? "Add revision and open review" : "Return to review"}</button></section>`}
  </section>`;
}

function noRevision(message: string): string { return `<section class="eui-page">${pageHeading({ id: "revision-title", eyebrow: "Revision comparison", title: "No comparison", summary: message })}<div class="empty-state">${icon("git-compare")}<h2>No comparison is available</h2><p>${escapeHtml(message)}</p></div></section>`; }
function tone(state: RevisionState): string { return ({ unchanged: "quiet", modified: "warning", added: "success", removed: "danger", relocated: "info", unmatched: "neutral" } as const)[state]; }
function description(state: RevisionState): string { return ({ unchanged: "Decision retained", modified: "Review again", added: "New review", removed: "Prior evidence", relocated: "Decision retained", unmatched: "Mapping needed" } as const)[state]; }
