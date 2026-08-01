import type { WorkspaceActions, WorkspaceState } from "./contracts.ts";
import { button, el, empty, select } from "./dom.ts";
import { formatDate, getMetrics, labelState } from "./view-model.ts";

export function renderDashboard(document: Document, state: WorkspaceState, actions: WorkspaceActions, go: (page: "import" | "review" | "findings" | "exports") => void): HTMLElement {
  const metrics = getMetrics(state.data.slices, state.data.findings);
  const section = el(document, "section", "page-content dashboard");
  section.append(el(document, "div", "page-actions", {}, button(document, "New Review", () => { go("import"); void actions.createProject(); }, "button primary"), button(document, "Import Revision", () => { void actions.importRevision(); }, "button"), button(document, "View Findings", () => go("findings"), "button"), button(document, "Export Report", () => go("exports"), "button")));
  const statRow = el(document, "section", "stat-row", { "aria-label": "Review status" });
  for (const [label, value] of [["Completion", `${metrics.completionPercent}%`], ["Remaining", String(metrics.remaining)], ["Open findings", String(metrics.findings)], ["Re-review", String(metrics.reReview)]]) statRow.append(el(document, "div", "stat", {}, el(document, "span", "stat-label", {}, label), el(document, "strong", "stat-value", {}, value)));
  section.append(statRow, renderProjects(document, state, actions, go));
  return section;
}

function renderProjects(document: Document, state: WorkspaceState, actions: WorkspaceActions, go: (page: "review") => void): HTMLElement {
  if (!state.data.projects.length) return empty(document, "No review projects", "Create a local review project from an artifact.", button(document, "Import Artifact", () => go("review"), "button primary"));
  const panel = el(document, "section", "panel project-panel", { "aria-labelledby": "project-list" });
  panel.append(el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Recent work"), el(document, "h2", "section-title", { id: "project-list" }, "Review projects"))));
  const table = el(document, "table", "data-table", {}, el(document, "thead", "", {}, el(document, "tr", "", {}, el(document, "th", "", { scope: "col" }, "Project"), el(document, "th", "number", { scope: "col" }, "Complete"), el(document, "th", "number", { scope: "col" }, "Findings"), el(document, "th", "", { scope: "col" }, "Activity"))));
  const body = el(document, "tbody");
  for (const project of state.data.projects) {
    const open = button(document, "Open", () => { void actions.openProject(project.id); go("review"); }, "table-link");
    body.append(el(document, "tr", "", {}, el(document, "td", "", {}, open, el(document, "span", "table-meta mono", { title: project.path }, project.path)), el(document, "td", "number", {}, `${project.completionPercent}%`), el(document, "td", "number", {}, String(project.openFindings)), el(document, "td", "", {}, formatDate(project.updatedAt))));
  }
  table.append(body); panel.append(table); return panel;
}

export function renderImport(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  const current = state.data.importState; const phases = ["Select artifact", "Detect structure", "Preview slices", "Confirm project"];
  const section = el(document, "section", "page-content import-page");
  section.append(el(document, "p", "page-description", {}, "Create source-linked slices. Imported sources remain unchanged."));
  const steps = el(document, "ol", "step-list", { "aria-label": "Import steps" });
  const active = ["select", "detect", "preview", "confirm"].indexOf(current.phase);
  phases.forEach((phase, index) => steps.append(el(document, "li", index === active ? "is-current" : index < active ? "is-complete" : "", { "aria-current": index === active ? "step" : undefined }, `${index + 1}. ${phase}`)));
  section.append(steps);
  if (current.error) return section.appendChild(renderImportError(document, current.error.message, current.error.recovery, actions));
  const form = el(document, "section", "import-form", { "aria-label": "Artifact import" });
  form.append(el(document, "div", "form-group", {}, el(document, "p", "eyebrow", {}, "Source artifact"), el(document, "h2", "section-title", {}, current.artifactName ?? "Select a local artifact"), el(document, "p", "muted", {}, current.detectedKind ? `Detected type: ${current.detectedKind}` : "Select one file or source directory."), el(document, "div", "button-row", {}, button(document, "Choose File", () => actions.processing.selectFile(), "button primary", current.busy), button(document, "Choose Directory", () => actions.processing.selectDirectory(), "button", current.busy), button(document, "Detect Structure", () => actions.processing.detectStructure(), "button", current.busy || !current.artifactName))));
  form.append(el(document, "div", "form-group", {}, el(document, "p", "eyebrow", {}, "Slice settings"), select(document, "Slice strategy", current.options.strategy ?? "auto", ["auto", "heading", "paragraph", "row", "object", "element", "file", "function", "diff-hunk", "manual"], (strategy) => void actions.processing.previewSlices({ ...current.options, strategy: strategy as typeof current.options.strategy }))));
  if (current.result) form.append(renderPreview(document, state, actions));
  section.append(form); return section;
}

function renderPreview(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  const result = state.data.importState.result!;
  const panel = el(document, "section", "panel preview-panel", {}, el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Slice preview"), el(document, "h2", "section-title", {}, `${result.slices.length} generated slices`)), button(document, "Confirm Project", () => actions.processing.confirmProject(), "button primary", state.data.importState.busy)));
  if (result.warnings.length) panel.append(el(document, "p", "validation-summary", { role: "status" }, `${result.warnings.length} warnings require review before confirmation.`));
  const list = el(document, "div", "preview-list");
  result.slices.slice(0, 8).forEach((slice) => list.append(el(document, "div", "preview-row", {}, el(document, "strong", "", {}, slice.title), el(document, "span", "table-meta mono", {}, `${slice.source.path} · ${labelState(slice.reviewState)}`))));
  panel.append(list); return panel;
}

function renderImportError(document: Document, message: string, recovery: string, actions: WorkspaceActions): HTMLElement {
  return el(document, "section", "validation-summary", { role: "alert" }, el(document, "h2", "section-title", {}, "Resolve import"), el(document, "p", "", {}, message), el(document, "p", "muted", {}, recovery), button(document, "Retry Import", () => actions.processing.retryImport(), "button primary"));
}
