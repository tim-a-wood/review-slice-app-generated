import type { WorkspaceActions, WorkspaceState } from "./contracts.ts";
import { button, el, empty, input, select } from "./dom.ts";
import { formatDate, getMetrics } from "./view-model.ts";

export function renderFindings(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  if (!state.data.findings.length) return empty(document, "No findings", "Add a finding from a source slice during review.");
  const section = el(document, "section", "page-content"); const panel = el(document, "section", "panel findings-panel", {}, el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Findings register"), el(document, "h2", "section-title", {}, "Findings"))));
  const query = { value: "" }; const filter = { value: "all" }; const table = el(document, "table", "data-table", {}, el(document, "thead", "", {}, el(document, "tr", "", {}, el(document, "th", "", { scope: "col" }, "Finding"), el(document, "th", "", { scope: "col" }, "Status"), el(document, "th", "", { scope: "col" }, "Source"), el(document, "th", "", { scope: "col" }, "Created")))); const body = el(document, "tbody"); table.append(body);
  const redraw = (): void => {
    body.replaceChildren();
    for (const finding of state.data.findings.filter((item) => (!query.value || `${item.id} ${item.description} ${item.type}`.toLowerCase().includes(query.value.toLowerCase())) && (filter.value === "all" || item.status === filter.value))) {
      const row = el(document, "tr", "", {},
        el(document, "td", "", {}, button(document, finding.id, () => actions.openFindingSource(finding.id), "table-link"), el(document, "span", "table-meta", {}, finding.description)),
        el(document, "td", "", {}, select(document, `Status ${finding.id}`, finding.status, ["Open", "Addressed", "Verified", "Rejected", "Deferred"], (status) => actions.updateFinding(finding.id, status as typeof finding.status))),
        el(document, "td", "", {}, button(document, finding.source.title, () => actions.openFindingSource(finding.id), "table-link")),
        el(document, "td", "", {}, formatDate(finding.createdAt)),
      );
      body.append(row);
    }
  };
  panel.append(el(document, "div", "filter-row", {}, input(document, "Find findings", "", (value) => { query.value = value; redraw(); }, { placeholder: "Search findings", className: "field compact" }), select(document, "Filter status", "all", ["all", "Open", "Addressed", "Verified", "Rejected", "Deferred"], (value) => { filter.value = value; redraw(); })), table); redraw(); section.append(panel); return section;
}

export function renderExports(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  const metrics = getMetrics(state.data.slices, state.data.findings);
  const section = el(document, "section", "page-content export-page");
  section.append(el(document, "p", "page-description", {}, "Create local evidence files from the current review state."));
  const panel = el(document, "section", "panel export-panel", {}, el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Review evidence"), el(document, "h2", "section-title", {}, "Evidence ZIP")), button(document, "Export Evidence", () => actions.exportEvidence(), "button primary", !state.data.exportData)));
  const files = ["review-summary.md", "findings.csv", "review-history.json", "slice-manifest.json", "source-manifest.json"];
  panel.append(el(document, "div", "export-summary", {}, el(document, "span", "", {}, `${metrics.completionPercent}% complete`), el(document, "span", "", {}, `${metrics.total} slices`), el(document, "span", "", {}, `${metrics.findings} open findings`), el(document, "span", "mono", {}, state.data.dataPath)), el(document, "ul", "file-list", {}, ...files.map((file) => el(document, "li", "mono", {}, file))), state.data.exportData ? el(document, "p", "save-state", { role: "status" }, "Evidence data is ready for export.") : el(document, "p", "validation-summary", { role: "status" }, "Load review data before you export evidence."));
  section.append(panel); return section;
}
