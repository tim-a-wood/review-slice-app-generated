import type { ProjectRow, WorkspaceView } from "./contracts.ts";
import { attribute, escapeHtml, icon, pageHeading } from "./dom.ts";
import { formatDate, label, metrics } from "./view-model.ts";

export function renderDashboard(view: WorkspaceView): string {
  const current = view.project;
  const currentMetrics = metrics(view.slices, view.findings);
  return `<section class="eui-page dashboard-page" data-view="dashboard" aria-labelledby="dashboard-title">
    ${pageHeading({ id: "dashboard-title", eyebrow: "Local review workspace", title: "Review projects", summary: "Continue a review, resolve open findings, or start a deterministic import.", actions: `
        <button class="eui-button secondary" type="button" data-action="start-revision" ${current ? "" : "disabled"}>${icon("git-compare")}Import revision</button>
        <button class="eui-button primary" type="button" data-action="start-project">${icon("plus")}New review</button>
      ` })}
    ${current ? `<section class="continue-panel" aria-labelledby="continue-title">
      <div class="continue-copy">
        <p class="eyebrow">Continue where you stopped</p>
        <h2 id="continue-title">${escapeHtml(current.name)}</h2>
        <p>${escapeHtml(current.description ?? "Structured technical review")}</p>
        <div class="progress-track" role="progressbar" aria-label="Review completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${currentMetrics.completionPercent}"><span style="width:${currentMetrics.completionPercent}%"></span></div>
        <div class="progress-caption"><strong>${currentMetrics.completionPercent}% complete</strong><span>${currentMetrics.remaining} slices remain</span></div>
      </div>
      <div class="continue-actions">
        <span class="save-proof">${icon("shield-check")}Stored locally</span>
        <button class="eui-button primary" type="button" data-action="open-review">Continue review${icon("arrow-right")}</button>
      </div>
    </section>` : renderEmptyProject()}
    <section class="status-summary" aria-label="Active review status">
      ${metric("Completion", `${currentMetrics.completionPercent}%`, `${currentMetrics.reviewed} of ${currentMetrics.total} reviewed`, "progress")}
      ${metric("Remaining", currentMetrics.remaining, currentMetrics.remaining ? "In the review queue" : "Queue complete", "remaining")}
      ${metric("Open findings", currentMetrics.openFindings, currentMetrics.openFindings ? "Require follow-up" : "No open concerns", "findings")}
      ${metric("Re-review", currentMetrics.reReview, currentMetrics.reReview ? "Changed content" : "No changed slices", "rereview")}
    </section>
    <div class="dashboard-grid">
      <section class="eui-panel project-table-panel" aria-labelledby="projects-title">
        <div class="panel-heading">
          <div><p class="eyebrow">Review portfolio</p><h2 id="projects-title">Recent projects</h2></div>
          <span class="record-count">${view.projects.length} ${view.projects.length === 1 ? "project" : "projects"}</span>
        </div>
        ${renderProjectTable(view.projects)}
      </section>
      <aside class="eui-panel attention-panel" aria-labelledby="attention-title">
        <div class="panel-heading"><div><p class="eyebrow">Next actions</p><h2 id="attention-title">Review attention</h2></div>${icon("circle-help", "About review attention")}</div>
        ${attentionRow("Modified slices", view.slices.filter((slice) => slice.revisionState === "modified").length, "Review source changes", "open-changed")}
        ${attentionRow("Open questions", view.findings.filter((finding) => finding.type === "Question" && finding.status !== "Verified" && finding.status !== "Rejected").length, "Clarification is pending", "open-questions")}
        ${attentionRow("Uncertain mappings", view.comparison?.comparison.uncertainCandidates.length ?? 0, "Confirm source links", "open-mappings")}
        <button class="eui-link full-link" type="button" data-action="open-evidence">View evidence readiness${icon("arrow-right")}</button>
      </aside>
    </div>
    <footer class="data-location">${icon("folder-open")}<span><strong>Application data</strong><code>${escapeHtml(view.dataPath)}</code></span><span class="offline-badge">Offline</span></footer>
  </section>`;
}

function metric(title: string, value: string | number, detail: string, kind: string): string {
  return `<div class="status-summary-item ${kind}"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function renderEmptyProject(): string {
  return `<section class="continue-panel empty-project"><div class="empty-illustration">${icon("clipboard-check")}</div><div class="continue-copy"><p class="eyebrow">Start a finite review</p><h2>No active review</h2><p>Import a local artifact to create a source-linked review queue.</p></div><button class="eui-button primary" type="button" data-action="start-project">Create review${icon("arrow-right")}</button></section>`;
}

function renderProjectTable(projects: readonly ProjectRow[]): string {
  if (!projects.length) return `<div class="empty-inline"><p>No review projects are stored yet.</p><button class="eui-button secondary" type="button" data-action="start-project">Import an artifact</button></div>`;
  return `<div class="table-scroll"><table class="eui-table"><thead><tr><th>Project</th><th>Progress</th><th>Findings</th><th>Last activity</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${projects.map((row) => `<tr class="${row.project.archived ? "is-archived" : ""}">
    <td><button class="record-link" type="button" data-action="open-project" data-project-id="${attribute(row.project.id)}" ${row.project.archived ? "disabled" : ""}><span class="record-icon">${icon(row.project.archived ? "archive" : "book-open")}</span><span><strong>${escapeHtml(row.project.name)}</strong><small>${row.project.archived ? "Archived" : escapeHtml(row.project.revisions.at(-1)?.label ?? "No revision")}</small></span></button></td>
    <td><div class="mini-progress"><span><i style="width:${row.completionPercent}%"></i></span><strong>${row.completionPercent}%</strong></div></td>
    <td><span class="status-text ${row.openFindings ? "warning" : "success"}"><i></i>${row.openFindings} open</span></td>
    <td><time datetime="${attribute(row.project.updatedAt)}">${escapeHtml(formatDate(row.project.updatedAt))}</time></td>
    <td><div class="project-actions"><button class="icon-button" type="button" data-action="rename-project" data-project-id="${attribute(row.project.id)}" aria-label="Rename ${attribute(row.project.name)}" data-tooltip="Rename">${icon("settings-2")}</button><button class="icon-button" type="button" data-action="${row.project.archived ? "restore-project" : "archive-project"}" data-project-id="${attribute(row.project.id)}" aria-label="${row.project.archived ? "Restore" : "Archive"} ${attribute(row.project.name)}" data-tooltip="${row.project.archived ? "Restore" : "Archive"}">${icon(row.project.archived ? "refresh-cw" : "archive")}</button><button class="icon-button danger-icon" type="button" data-action="delete-project" data-project-id="${attribute(row.project.id)}" aria-label="Delete ${attribute(row.project.name)}" data-tooltip="Delete">${icon("trash-2")}</button></div></td>
  </tr>`).join("")}</tbody></table></div>`;
}

function attentionRow(title: string, count: number, detail: string, action: string): string {
  return `<button class="attention-row" type="button" data-action="${action}" ${count ? "" : "disabled"}><span class="attention-count">${count}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>${icon("arrow-right")}</button>`;
}

export function renderImport(view: WorkspaceView): string {
  const draft = view.importDraft;
  const phases = [
    ["select", "Select artifact", "Choose a source"],
    ["detect", "Detect structure", "Check the parser"],
    ["preview", "Preview slices", "Adjust boundaries"],
    ["confirm", "Confirm project", "Start the review"],
  ] as const;
  const activeIndex = phases.findIndex(([phase]) => phase === draft.phase);
  return `<section class="eui-page import-page" data-view="import" aria-labelledby="import-title">
    ${pageHeading({ id: "import-title", eyebrow: draft.mode === "revision" ? "Add artifact revision" : "New review project", title: "Import artifact", summary: "Review Slice reads a local copy and never modifies the source artifact.", actions: `<button class="eui-button ghost" type="button" data-action="cancel-import">${icon("x")}Cancel</button>` })}
    <ol class="stepper" aria-label="Import progress">${phases.map(([phase, title, detail], index) => `<li class="${index === activeIndex ? "is-current" : index < activeIndex ? "is-complete" : ""}" ${index === activeIndex ? 'aria-current="step"' : ""}><span>${index < activeIndex ? icon("check") : index + 1}</span><div><strong>${title}</strong><small>${detail}</small></div></li>`).join("")}</ol>
    ${draft.phase === "select" ? renderSelectStep(draft.mode) : draft.phase === "detect" ? renderDetectStep(view) : draft.phase === "preview" ? renderPreviewStep(view) : renderConfirmStep(view)}
  </section>`;
}

function renderSelectStep(mode: "new-project" | "revision"): string {
  return `<section class="eui-panel import-stage" aria-labelledby="select-source-title">
    <div class="stage-copy"><span class="stage-icon">${icon("folder-open")}</span><div><p class="eyebrow">Step 1</p><h2 id="select-source-title">Select a local artifact</h2><p>Choose one supported file or a source-code directory. The app records source locations and a content hash.</p></div></div>
    <div class="source-choice-grid">
      <button class="source-choice" type="button" data-action="choose-file"><span>${icon("file-plus")}</span><strong>Choose file</strong><small>Markdown, text, DOCX, PDF, CSV, JSON, XML, or diff</small></button>
      <button class="source-choice" type="button" data-action="choose-directory"><span>${icon("folder-open")}</span><strong>Choose source directory</strong><small>Slice code by file, class, function, or method</small></button>
    </div>
    <input class="visually-hidden" id="review-slice-file" type="file" accept=".md,.markdown,.txt,.docx,.pdf,.csv,.json,.xml,.diff,.patch" data-import-mode="${mode}">
    <input class="visually-hidden" id="review-slice-directory" type="file" webkitdirectory multiple data-import-mode="${mode}">
    <div class="privacy-note">${icon("shield-check")}<span><strong>Private by design.</strong> Source content stays on this computer. Network access is not required.</span></div>
  </section>`;
}

function renderDetectStep(view: WorkspaceView): string {
  const draft = view.importDraft;
  return `<section class="eui-panel import-stage" aria-labelledby="detect-title">
    <div class="panel-heading"><div><p class="eyebrow">Step 2</p><h2 id="detect-title">Detected structure</h2></div><span class="status-chip info">${draft.detectedKind ? label(draft.detectedKind) : "Reading source"}</span></div>
    <div class="artifact-summary"><span class="file-glyph">${icon("files")}</span><div><strong>${escapeHtml(draft.sources[0]?.displayName ?? "Selected source")}</strong><small>${draft.sources.length > 1 ? `${draft.sources.length} source files` : "One immutable source file"}</small></div></div>
    <div class="detection-grid"><div><span>Detected type</span><strong>${escapeHtml(label(draft.detectedKind ?? "pending"))}</strong></div><div><span>Default strategy</span><strong>${escapeHtml(label(String(draft.options.strategy ?? "auto")))}</strong></div><div><span>Parser version</span><strong>1.0.0</strong></div></div>
    <div class="stage-actions"><button class="eui-button secondary" type="button" data-action="import-back">${icon("arrow-left")}Back</button><button class="eui-button primary" type="button" data-action="detect-structure" ${draft.busy ? "disabled" : ""}>${draft.busy ? icon("refresh-cw") + "Detecting" : "Preview slices" + icon("arrow-right")}</button></div>
  </section>`;
}

function renderPreviewStep(view: WorkspaceView): string {
  const draft = view.importDraft;
  const result = draft.result;
  if (!result) return `<section class="eui-panel import-stage"><div class="empty-inline"><p>No slice preview is available.</p><button class="eui-button secondary" type="button" data-action="detect-structure">Retry detection</button></div></section>`;
  return `<div class="preview-layout">
    <aside class="eui-panel settings-panel" data-surface-kind="structural-pane" aria-labelledby="slice-settings-title">
      <div><p class="eyebrow">Slicing controls</p><h2 id="slice-settings-title">Structure</h2></div>
      <label class="eui-field"><span>Strategy</span><select class="eui-control" data-field="strategy">${["auto", "heading", "paragraph", "numbered-section", "requirement", "row", "object", "element", "file", "function", "diff-hunk", "manual"].map((value) => `<option value="${value}" ${result.slicing.strategy === value ? "selected" : ""}>${label(value)}</option>`).join("")}</select></label>
      <label class="eui-field"><span>Heading depth</span><input class="eui-control" type="number" min="1" max="6" value="${result.slicing.headingDepth}" data-field="headingDepth"><small>Include headings through this level.</small></label>
      <label class="eui-field"><span>Combine below</span><div class="input-suffix"><input class="eui-control" type="number" min="0" value="${result.slicing.combineBelowCharacters}" data-field="combineBelowCharacters"><span>characters</span></div></label>
      <label class="eui-field"><span>Split above</span><div class="input-suffix"><input class="eui-control" type="number" min="200" value="${result.slicing.splitAboveCharacters}" data-field="splitAboveCharacters"><span>characters</span></div></label>
      <button class="eui-button secondary full" type="button" data-action="refresh-preview">${icon("refresh-cw")}Update preview</button>
      <div class="help-callout" data-help-trigger>${icon("circle-help")}<p><strong>Stable slice keys</strong><span>Review decisions can follow unchanged content into the next revision.</span></p></div>
    </aside>
    <section class="eui-panel preview-panel" aria-labelledby="preview-title">
      <div class="panel-heading"><div><p class="eyebrow">Step 3</p><h2 id="preview-title">${result.preview.sliceCount} reviewable slices</h2></div><span class="estimate">About ${result.preview.estimatedMinutes} minutes</span></div>
      <div class="preview-summary"><span><strong>${result.preview.totalCharacters.toLocaleString()}</strong> characters</span><span><strong>${result.preview.oversizedSliceIds.length}</strong> oversized</span><span><strong>${result.preview.excludedSectionCount}</strong> excluded</span><span><strong>${draft.warnings.length}</strong> warnings</span></div>
      ${draft.warnings.length ? `<div class="inline-alert warning" role="status">${icon("triangle-alert")}<span><strong>Review ${draft.warnings.length} parser ${draft.warnings.length === 1 ? "warning" : "warnings"}.</strong> ${escapeHtml(draft.warnings[0]?.message)}</span></div>` : ""}
      <div class="table-scroll preview-table"><table class="eui-table"><thead><tr><th><span class="sr-only">Include</span></th><th>Slice</th><th>Source location</th><th>Size</th><th>Assessment</th></tr></thead><tbody>${result.slices.map((slice) => {
        const excluded = draft.excludedMatchKeys.includes(slice.matchKey);
        const oversized = result.preview.oversizedSliceIds.includes(slice.id);
        return `<tr class="${excluded ? "is-excluded" : ""}"><td><input type="checkbox" aria-label="Include ${attribute(slice.title)}" data-action="toggle-slice" data-match-key="${attribute(slice.matchKey)}" ${excluded ? "" : "checked"}></td><td><strong>${escapeHtml(slice.title)}</strong><small class="mono">${escapeHtml(slice.matchKey)}</small></td><td><code>${escapeHtml(slice.source.locator ?? `${slice.source.startLine}-${slice.source.endLine}`)}</code></td><td>${slice.preview.characterCount.toLocaleString()} chars</td><td><span class="status-chip ${oversized ? "warning" : "neutral"}">${oversized ? "Oversized" : "Ready"}</span></td></tr>`;
      }).join("")}</tbody></table></div>
      <div class="stage-actions"><button class="eui-button secondary" type="button" data-action="preview-back">${icon("arrow-left")}Back</button><button class="eui-button primary" type="button" data-action="preview-confirm">Review confirmation${icon("arrow-right")}</button></div>
    </section>
  </div>`;
}

function renderConfirmStep(view: WorkspaceView): string {
  const draft = view.importDraft;
  const result = draft.result;
  return `<section class="eui-panel import-stage confirm-stage" aria-labelledby="confirm-title">
    <div class="confirmation-mark">${icon("clipboard-check")}</div>
    <div class="confirm-copy"><p class="eyebrow">Step 4</p><h2 id="confirm-title">Confirm ${draft.mode === "revision" ? "the revision" : "the review project"}</h2><p>Review the source and slice settings before Review Slice creates the local queue.</p></div>
    <div class="confirmation-grid">
      <label class="eui-field"><span>${draft.mode === "revision" ? "Project" : "Project name"}</span><input class="eui-control" data-field="projectName" value="${attribute(draft.projectName)}" ${draft.mode === "revision" ? "readonly" : ""}></label>
      <label class="eui-field"><span>Revision label</span><input class="eui-control" data-field="revisionLabel" value="${attribute(draft.revisionLabel)}"></label>
      <div class="confirmation-record"><span>Artifact</span><strong>${escapeHtml(result?.artifact.displayName ?? draft.sources[0]?.displayName ?? "Not selected")}</strong></div>
      <div class="confirmation-record"><span>Review queue</span><strong>${result?.slices.length ?? 0} slices</strong></div>
      <div class="confirmation-record"><span>Slicing strategy</span><strong>${escapeHtml(label(String(result?.slicing.strategy ?? draft.options.strategy ?? "auto")))}</strong></div>
      <div class="confirmation-record"><span>Source policy</span><strong>Read-only import</strong></div>
    </div>
    <div class="inline-alert success">${icon("shield-check")}<span><strong>Ready to create.</strong> Progress saves after each review action and remains on this computer.</span></div>
    <div class="stage-actions"><button class="eui-button secondary" type="button" data-action="confirm-back">${icon("arrow-left")}Back</button><button class="eui-button primary" type="button" data-action="confirm-import" ${draft.busy || !result?.slices.length ? "disabled" : ""}>${draft.mode === "revision" ? "Import revision" : "Create review"}${icon("arrow-right")}</button></div>
  </section>`;
}
