import type { WorkspaceActions, WorkspaceState } from "./contracts.ts";
import { button, el, empty } from "./dom.ts";
import { formatDate, labelState, sourceLabel } from "./view-model.ts";

export function renderRevisions(document: Document, state: WorkspaceState, actions: WorkspaceActions, go: (page: "mappings") => void): HTMLElement {
  const revision = state.data.revision;
  if (!revision) return empty(document, "No imported revision", "Import a later artifact revision to compare source slices.", button(document, "Import Revision", () => actions.importRevision(), "button primary"));
  const section = el(document, "section", "page-content");
  section.append(el(document, "div", "page-actions", {}, button(document, "Import Revision", () => actions.importRevision(), "button primary"), button(document, "Correct Mappings", () => go("mappings"), "button")));
  const panel = el(document, "section", "panel revision-panel", {}, el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Revision comparison"), el(document, "h2", "section-title", {}, revision.label), el(document, "p", "muted", {}, `${revision.previousLabel ?? "Previous revision"} → ${formatDate(revision.importedAt)}`))));
  const list = el(document, "div", "revision-counts");
  for (const [stateName, count] of Object.entries(revision.counts)) list.append(el(document, "div", "status-readout", {}, el(document, "span", "", {}, labelState(stateName as keyof typeof revision.counts)), el(document, "strong", "mono", {}, String(count))));
  panel.append(list, el(document, "p", "muted", {}, `${revision.candidates.length} uncertain mappings require review.`)); section.append(panel); return section;
}

export function renderMappings(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  if (!state.data.mappings.length) return empty(document, "No uncertain mappings", "The current revision has no mappings that need correction.");
  const section = el(document, "section", "page-content");
  section.append(el(document, "p", "page-description", {}, "Confirm a source pair only after you inspect both locations."));
  const panel = el(document, "section", "panel mapping-panel", {}, el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Manual mapping"), el(document, "h2", "section-title", {}, "Uncertain mappings"))));
  const list = el(document, "div", "mapping-list");
  for (const item of state.data.mappings) {
    const previous = item.previous; const current = item.current;
    const row = el(document, "article", "mapping-row", {}, el(document, "div", "mapping-source", {}, el(document, "span", "eyebrow", {}, "Previous slice"), el(document, "strong", "", {}, previous?.title ?? item.candidate.previousSliceId), previous ? el(document, "span", "table-meta mono", {}, sourceLabel(previous)) : el(document, "span", "table-meta", {}, "Removed source")), el(document, "div", "mapping-arrow", { "aria-hidden": "true" }, "→"), el(document, "div", "mapping-source", {}, el(document, "span", "eyebrow", {}, "Current slice"), el(document, "strong", "", {}, current?.title ?? item.candidate.currentSliceId), current ? el(document, "span", "table-meta mono", {}, sourceLabel(current)) : el(document, "span", "table-meta", {}, "No current source")), el(document, "div", "mapping-confidence", {}, el(document, "span", "table-meta", {}, `${Math.round(item.candidate.confidence * 100)}% confidence`), button(document, "Confirm Mapping", () => actions.correctMapping({ previousSliceId: item.candidate.previousSliceId, currentSliceId: item.candidate.currentSliceId, correctedAt: new Date().toISOString() }), "button")));
    list.append(row);
  }
  panel.append(list); section.append(panel); return section;
}
