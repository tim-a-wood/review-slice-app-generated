import type { ReviewSlice, WorkspaceView } from "./contracts.ts";
import { attribute, escapeHtml, icon, pageHeading } from "./dom.ts";
import { compareLines, label, metrics, reviewUnitSliceIds, sourceLabel, visibleSlices } from "./view-model.ts";

const filters = ["all", "not-reviewed", "finding", "question", "re-review-required", "changed", "added", "skipped"] as const;

export function renderReview(view: WorkspaceView): string {
  const slice = view.activeSlice;
  if (!view.project || !slice) return `<section class="eui-page">${pageHeading({ id: "review-title", eyebrow: "Review workspace", title: "Review queue", summary: "Open a project or import an artifact to begin." })}<div class="empty-state">${icon("clipboard-check")}<h2>No review queue is open</h2><p>Open a project or import an artifact to begin.</p><button class="eui-button primary" type="button" data-action="start-project">Create review</button></div></section>`;
  const currentMetrics = metrics(view.slices, view.findings);
  const rows = visibleSlices(view);
  const linkedSliceIds = reviewUnitSliceIds(view.project, slice);
  const sliceFindings = view.findings.filter((finding) => linkedSliceIds.has(finding.source.sliceId));
  return `<section class="review-page" data-view="review" aria-labelledby="review-title">
    <header class="review-toolbar">
      <div class="project-crumb"><span>${escapeHtml(view.project.name)}</span>${icon("chevron-down")}<strong>${escapeHtml(view.revisionLabel ?? "Current revision")}</strong></div>
      <div class="review-progress"><span>${currentMetrics.reviewed} of ${currentMetrics.total} reviewed</span><div class="progress-track small" role="progressbar" aria-label="Review completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${currentMetrics.completionPercent}"><i style="width:${currentMetrics.completionPercent}%"></i></div><strong>${currentMetrics.completionPercent}%</strong></div>
      <button class="eui-button secondary" type="button" data-action="start-revision">${icon("git-compare")}Import revision</button>
    </header>
    <div class="review-workspace" data-layout-recipe="RCP-WORKBENCH-001">
      <aside class="slice-navigator" data-region-id="context-rail" data-region-role="context" data-region-priority="2" data-surface-kind="structural-pane" data-wide-column-start="1" data-wide-column-span="1" data-wide-row-start="1" data-region-order="2" data-narrow-behavior="drawer" aria-labelledby="queue-title">
        <div class="pane-heading"><div><p class="eyebrow">Review queue</p><h2 id="queue-title">Slices <span>${rows.length}</span></h2></div><button class="icon-button" type="button" data-action="collapse-slices" aria-label="Collapse review navigator" data-tooltip="Collapse navigator">${icon("panel-left-close")}</button></div>
        <label class="search-control">${icon("search")}<span class="sr-only">Find slices</span><input type="search" placeholder="Find title or source" value="${attribute(view.query)}" data-field="sliceQuery"></label>
        <div class="filter-chips" aria-label="Slice filters">${filters.map((filter) => `<button type="button" class="filter-chip ${view.filter === filter ? "is-active" : ""}" data-action="filter-slices" data-filter="${filter}" aria-pressed="${view.filter === filter}">${escapeHtml(filter === "all" ? "All" : label(filter))}</button>`).join("")}</div>
        <div class="slice-list" role="listbox" aria-label="Review slices">${rows.length ? rows.map((item) => sliceRow(item, view)).join("") : `<div class="empty-inline"><p>No slices match this filter.</p><button class="eui-link" type="button" data-action="clear-slice-filter">Clear filter</button></div>`}</div>
      </aside>
      <main class="source-viewer" data-region-id="work-surface" data-region-role="primary" data-region-priority="1" data-surface-kind="primary-work-surface" data-wide-column-start="2" data-wide-column-span="1" data-wide-row-start="1" data-region-order="1" data-narrow-behavior="retain">
        <div class="source-header">
          <div class="state-line"><span class="status-chip ${revisionTone(slice.revisionState)}">${escapeHtml(label(slice.revisionState))}</span><span class="status-chip ${reviewTone(slice.reviewState)}">${escapeHtml(label(slice.reviewState))}</span>${slice.previousReviewState ? `<span class="prior-state">Prior: ${escapeHtml(label(slice.previousReviewState))}</span>` : ""}</div>
          <div class="source-actions"><button class="eui-button ghost compact" type="button" data-action="toggle-diff" aria-pressed="${view.showDiff}">${icon("columns")}${view.showDiff ? "Current only" : "Compare revisions"}</button><button class="icon-button" type="button" data-action="copy-source-link" aria-label="Copy source location" data-tooltip="Copy source location">${icon("tag")}</button></div>
        </div>
        ${pageHeading({ id: "review-title", eyebrow: `Slice ${slice.sequence + 1} of ${view.slices.filter((item) => item.revisionState !== "removed").length}`, title: slice.title, summary: sourceLabel(slice), className: "source-title-block" })}
        ${slice.revisionState === "modified" || slice.revisionState === "added" || slice.revisionState === "unmatched" ? `<div class="change-banner">${icon("git-compare")}<span><strong>This slice requires review.</strong> ${slice.revisionState === "modified" ? "The source differs from the previous revision." : slice.revisionState === "added" ? "This content is new in the active revision." : "No reliable prior mapping was found."}</span></div>` : ""}
        ${view.showDiff && view.previousSlice ? renderDiff(view.previousSlice.content, slice.content) : `<article class="document-sheet" aria-label="Read-only source content"><div class="document-rule"><span>${escapeHtml(slice.source.locator ?? slice.source.location)}</span><span>Read only</span></div><pre>${escapeHtml(slice.content)}</pre></article>`}
        ${slice.notes.length ? `<section class="review-notes" aria-labelledby="notes-title"><div class="panel-heading"><h2 id="notes-title">Review notes</h2><span>${slice.notes.length}</span></div>${slice.notes.map((note) => `<p><span>${escapeHtml(note.text)}</span><time datetime="${attribute(note.createdAt)}">${new Date(note.createdAt).toLocaleDateString()}</time></p>`).join("")}</section>` : ""}
        ${sliceFindings.length ? `<section class="linked-findings" aria-labelledby="linked-title"><div class="panel-heading"><h2 id="linked-title">Linked findings</h2><button class="eui-link" type="button" data-action="open-findings">View register</button></div>${sliceFindings.map((finding) => `<button type="button" data-action="open-finding" data-finding-id="${attribute(finding.id)}"><span class="finding-id">${escapeHtml(finding.id)}</span><span>${escapeHtml(finding.description)}</span><span class="status-text ${finding.status === "Open" ? "warning" : "neutral"}"><i></i>${escapeHtml(finding.status)}</span></button>`).join("")}</section>` : ""}
      </main>
      <aside class="action-rail" data-region-id="detail-inspector" data-region-role="inspector" data-region-priority="2" data-surface-kind="structural-pane" data-wide-column-start="3" data-wide-column-span="1" data-wide-row-start="1" data-region-order="3" data-narrow-behavior="drawer" aria-labelledby="actions-title">
        <div><p class="eyebrow">Disposition</p><h2 id="actions-title">Record review</h2><p>Each action saves immediately.</p></div>
        <button class="rail-action accept" type="button" data-action="accept-slice">${icon("check")}<span><strong>Accept</strong><small>No unresolved concern</small></span><kbd>A</kbd></button>
        <button class="rail-action" type="button" data-action="add-finding">${icon("triangle-alert")}<span><strong>Add finding</strong><small>Record a defect</small></span><kbd>F</kbd></button>
        <button class="rail-action" type="button" data-action="add-question">${icon("message-square")}<span><strong>Add question</strong><small>Request clarification</small></span><kbd>Q</kbd></button>
        <button class="rail-action" type="button" data-action="skip-slice">${icon("arrow-right")}<span><strong>Skip</strong><small>A reason is required</small></span><kbd>S</kbd></button>
        <button class="rail-action" type="button" data-action="add-note">${icon("plus")}<span><strong>Add note</strong><small>Private review context</small></span></button>
        <div class="rail-divider"></div>
        <div class="slice-navigation"><button class="eui-button secondary" type="button" data-action="previous-slice">${icon("arrow-left")}Previous <kbd>K</kbd></button><button class="eui-button primary" type="button" data-action="next-slice">Next <kbd>J</kbd>${icon("arrow-right")}</button></div>
        <div class="shortcut-guide"><span>Keyboard review</span><p><kbd>A</kbd> accept <kbd>F</kbd> finding <kbd>Q</kbd> question <kbd>S</kbd> skip</p></div>
      </aside>
    </div>
  </section>`;
}

function sliceRow(slice: ReviewSlice, view: WorkspaceView): string {
  const count = view.findings.filter((finding) => finding.source.sliceId === slice.id).length;
  return `<button class="slice-row ${slice.id === view.activeSlice?.id ? "is-active" : ""}" type="button" role="option" aria-selected="${slice.id === view.activeSlice?.id}" data-action="select-slice" data-slice-id="${attribute(slice.id)}"><span class="slice-state ${reviewTone(slice.reviewState)}"></span><span class="slice-copy"><strong>${escapeHtml(slice.title)}</strong><small>${escapeHtml(slice.source.locator ?? slice.source.location)}</small><span><em class="revision-text ${revisionTone(slice.revisionState)}">${escapeHtml(label(slice.revisionState))}</em>${count ? `<em>${count} ${icon("message-square")}</em>` : ""}</span></span></button>`;
}

function renderDiff(previous: string, current: string): string {
  return `<section class="diff-sheet" aria-label="Inline revision comparison"><header><div><span class="diff-key removed"></span>Previous revision</div><div><span class="diff-key added"></span>Current revision</div></header><div class="diff-lines">${compareLines(previous, current).map((line) => `<div class="diff-line ${line.kind}"><span>${line.oldLine ?? ""}</span><span>${line.newLine ?? ""}</span><code>${line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "} ${escapeHtml(line.text)}</code></div>`).join("")}</div></section>`;
}

function reviewTone(state: ReviewSlice["reviewState"]): string {
  return ({ accepted: "success", finding: "danger", question: "info", skipped: "quiet", "re-review-required": "warning", "not-reviewed": "neutral" } as const)[state];
}

function revisionTone(state: ReviewSlice["revisionState"]): string {
  return ({ unchanged: "quiet", modified: "warning", added: "success", removed: "danger", relocated: "info", unmatched: "neutral" } as const)[state];
}
