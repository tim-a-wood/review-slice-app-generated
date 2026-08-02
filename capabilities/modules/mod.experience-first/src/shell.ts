import type { WorkspaceDialog, WorkspacePage, WorkspaceView } from "./contracts.ts";
import { attribute, escapeHtml, icon, type IconName } from "./dom.ts";

const pages: readonly [WorkspacePage, string, IconName][] = [
  ["dashboard", "Dashboard", "layout-dashboard"],
  ["review", "Review workspace", "book-open"],
  ["revisions", "Revisions", "git-compare"],
  ["mappings", "Mappings", "columns"],
  ["findings", "Findings", "message-square"],
  ["evidence", "Evidence", "archive"],
];

export type ColorMode = "system" | "light" | "dark";

export function renderShell(view: WorkspaceView, content: string, collapsed: boolean, colorMode: ColorMode): string {
  const nextMode = colorMode === "system" ? "light" : colorMode === "light" ? "dark" : "system";
  const modeLabel = colorMode === "system" ? "System mode" : colorMode === "light" ? "Light mode" : "Dark mode";
  return `<div class="review-slice-shell ${collapsed ? "nav-is-collapsed" : ""}" data-design-contract="EUIT-FRONTEND-001" data-color-mode="${colorMode}">
    <aside class="app-sidebar" data-surface-kind="structural-pane">
      <div class="brand-lockup"><span class="brand-mark"><i></i><i></i><i></i></span><span><strong>Review Slice</strong><small>Technical review queue</small></span></div>
      <nav class="primary-navigation" aria-label="Primary navigation">${pages.map(([page, label, glyph]) => `<button type="button" class="nav-command ${view.page === page ? "is-active" : ""}" data-page="${page}" aria-current="${view.page === page ? "page" : "false"}" title="${attribute(label)}">${icon(glyph)}<span>${escapeHtml(label)}</span>${page === "findings" && view.findings.filter((finding) => finding.status === "Open").length ? `<em>${view.findings.filter((finding) => finding.status === "Open").length}</em>` : ""}</button>`).join("")}</nav>
      <div class="sidebar-footer"><div class="local-indicator"><span></span><div><strong>Local workspace</strong><small>Autosave on</small></div></div><button class="mode-button" type="button" data-action="theme" aria-label="Use ${nextMode} mode" title="Use ${nextMode} mode">${icon(colorMode === "dark" ? "moon" : "sun")}<span>${modeLabel}</span></button><button class="icon-button inverse" type="button" data-action="toggle-navigation" aria-label="${collapsed ? "Expand" : "Collapse"} navigation" data-tooltip="${collapsed ? "Expand" : "Collapse"} navigation">${icon(collapsed ? "panel-left-open" : "panel-left-close")}</button></div>
    </aside>
    <div class="app-main">
      <header class="application-bar"><div class="mobile-brand"><button class="icon-button" type="button" data-action="toggle-navigation" aria-label="Open navigation">${icon("menu")}</button><strong>Review Slice</strong></div><div class="application-context"><span>${escapeHtml(view.project?.name ?? "Review projects")}</span>${view.revisionLabel ? `<i></i><strong>${escapeHtml(view.revisionLabel)}</strong>` : ""}</div><div class="application-status"><span class="save-status ${view.status === "error" ? "error" : ""}" role="status" aria-live="polite">${view.status === "loading" ? icon("refresh-cw") + "Saving" : view.status === "error" ? icon("triangle-alert") + "Needs attention" : icon("check") + (view.savedAt ? `Saved ${new Date(view.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Local state ready")}</span><button class="icon-button" type="button" data-action="help" aria-label="Open help" data-help-trigger data-tooltip="Help">${icon("circle-help")}</button></div></header>
      ${view.error ? `<div class="global-message error" role="alert">${icon("triangle-alert")}<span><strong>The action did not finish.</strong>${escapeHtml(view.error)}</span><button type="button" data-action="clear-message" aria-label="Dismiss error">${icon("x")}</button></div>` : view.notice ? `<div class="global-message success" role="status">${icon("check")}<span>${escapeHtml(view.notice)}</span><button type="button" data-action="clear-message" aria-label="Dismiss message">${icon("x")}</button></div>` : ""}
      <main class="page-canvas" tabindex="-1">${content}</main>
    </div>
    ${view.dialog ? renderDialog(view.dialog) : ""}
  </div>`;
}

function renderDialog(dialog: WorkspaceDialog): string {
  const fields = dialog.kind === "finding" || dialog.kind === "question" || dialog.kind === "edit-finding"
    ? `<label class="eui-field"><span>Finding type</span><select class="eui-control" name="type">${["Defect", "Question", "Improvement", "Inconsistency", "Missing information", "Traceability issue", "Editorial issue", "Other"].map((type) => `<option ${dialog.findingType === type || (!dialog.findingType && dialog.kind === "question" && type === "Question") || (!dialog.findingType && dialog.kind === "finding" && type === "Defect") ? "selected" : ""}>${type}</option>`).join("")}</select></label><label class="eui-field"><span>Severity</span><select class="eui-control" name="severity">${["Major", "Critical", "Minor", "Info"].map((severity) => `<option ${dialog.findingSeverity === severity ? "selected" : ""}>${severity}</option>`).join("")}</select></label><label class="eui-field full"><span>Description</span><textarea class="eui-control" name="value" rows="5" required autofocus placeholder="State the concern and expected result.">${escapeHtml(dialog.initialValue ?? "")}</textarea><small>The source slice and exact location are linked automatically.</small></label>`
    : dialog.kind === "delete"
      ? `<div class="inline-alert warning">${icon("triangle-alert")}<span><strong>This project will be removed from the local workspace.</strong> Export evidence first if the history must be retained.</span></div><input type="hidden" name="value" value="delete">`
      : `<label class="eui-field full"><span>${dialog.kind === "skip" ? "Skip reason" : dialog.kind === "note" ? "Review note" : dialog.kind === "resolution" ? "Resolution note" : "Project name"}</span>${dialog.kind === "rename" ? `<input class="eui-control" name="value" value="${attribute(dialog.initialValue ?? "")}" required autofocus>` : `<textarea class="eui-control" name="value" rows="4" required autofocus></textarea>`}</label>`;
  return `<div class="dialog-scrim" data-action="dismiss-dialog"><section class="eui-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" data-dialog-kind="${dialog.kind}" data-target-id="${attribute(dialog.targetId)}" data-action="dialog-surface"><header><div><p class="eyebrow">Review Slice</p><h2 id="dialog-title">${escapeHtml(dialog.title)}</h2><p>${escapeHtml(dialog.description)}</p></div><button class="icon-button" type="button" data-action="dismiss-dialog" aria-label="Close dialog">${icon("x")}</button></header><form data-dialog-form><div class="dialog-fields">${fields}</div><footer><button class="eui-button secondary" type="button" data-action="dismiss-dialog">Cancel</button><button class="eui-button ${dialog.kind === "delete" ? "danger" : "primary"}" type="submit">${dialog.kind === "delete" ? "Delete project" : "Save"}</button></footer></form></section></div>`;
}
