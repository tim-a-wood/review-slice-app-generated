import type { WorkspaceActions, WorkspaceState } from "./contracts.ts";
import { button, el, input, select } from "./dom.ts";
import { getActiveSlice, getMetrics, getSliceRows, labelState, sourceLabel } from "./view-model.ts";

export function renderReview(document: Document, state: WorkspaceState, actions: WorkspaceActions, redraw: () => void): HTMLElement {
  const active = getActiveSlice(state.data); const metrics = getMetrics(state.data.slices, state.data.findings);
  const section = el(document, "section", "review-page", { "aria-label": "Review workspace" });
  section.append(el(document, "div", "work-summary", {}, el(document, "span", "", {}, `Slice ${active?.sequence ?? 0} of ${metrics.total}`), el(document, "span", "", {}, `${metrics.completionPercent}% complete`), el(document, "span", "", {}, `${metrics.findings} open findings`), el(document, "span", "mono", {}, state.data.dataPath)));
  if (!active) return section.appendChild(el(document, "section", "empty-state", {}, el(document, "h2", "section-title", {}, "No slices"), el(document, "p", "muted", {}, "Import an artifact to create a review queue.")));
  const grid = el(document, "div", "review-grid");
  grid.append(renderNavigator(document, state, actions), renderSource(document, active), renderActions(document, active.id, state.data.slices.map((slice) => slice.id), actions, redraw));
  section.append(grid); return section;
}

function renderNavigator(document: Document, state: WorkspaceState, actions: WorkspaceActions): HTMLElement {
  const rail = el(document, "aside", "panel navigator", { "aria-label": "Slice navigator" });
  rail.append(el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Review queue"), el(document, "h2", "section-title", {}, "Slices"))));
  const filters = el(document, "div", "filter-row"); let query = ""; let filter = "all";
  const list = el(document, "div", "slice-list");
  const repaint = (): void => {
    const rows = getSliceRows(state.data, query, filter).map((row) => {
      const item = button(document, row.slice.title, () => actions.selectSlice(row.slice.id), `slice-row ${row.active ? "is-active" : ""}`);
      item.replaceChildren(el(document, "span", "slice-row-content", {}, el(document, "strong", "slice-title", {}, row.slice.title), el(document, "span", "table-meta", {}, `${labelState(row.slice.reviewState)} · ${labelState(row.slice.revisionState)} · ${row.findingCount} findings`)));
      return item;
    });
    list.replaceChildren(...rows);
  };
  filters.append(input(document, "Find slices", "", (value) => { query = value; repaint(); }, { placeholder: "Search title or source", className: "field compact" }), select(document, "Filter slices", "all", ["all", "not-reviewed", "accepted", "finding", "question", "skipped", "re-review-required", "modified", "added", "unmatched"], (value) => { filter = value; repaint(); }));
  rail.append(filters, list); repaint(); return rail;
}

function renderSource(document: Document, slice: NonNullable<ReturnType<typeof getActiveSlice>>): HTMLElement {
  const panel = el(document, "article", "panel source-viewer", { "aria-labelledby": "source-title" });
  panel.append(el(document, "div", "panel-heading", {}, el(document, "div", "", {}, el(document, "p", "eyebrow", {}, "Read-only source"), el(document, "h2", "section-title", { id: "source-title" }, slice.title), el(document, "p", "source-location mono", {}, sourceLabel(slice)))));
  panel.append(el(document, "div", "state-pills", {}, el(document, "span", "pill", {}, labelState(slice.reviewState)), el(document, "span", "pill", {}, labelState(slice.revisionState))));
  if (slice.revisionState === "modified") panel.append(el(document, "p", "change-note", {}, "Changed content requires review. Inline changes use the source comparison."));
  panel.append(el(document, "pre", "source-content", { tabindex: "0", "aria-label": "Current slice source" }, slice.content));
  return panel;
}

function renderActions(document: Document, sliceId: string, sliceIds: readonly string[], actions: WorkspaceActions, redraw: () => void): HTMLElement {
  const rail = el(document, "aside", "panel action-rail", { "aria-label": "Review actions" });
  const decide = (state: "accepted" | "finding" | "question"): void => { void Promise.resolve(actions.decide(sliceId, state)).then(redraw); };
  rail.append(el(document, "p", "eyebrow", {}, "Actions"), button(document, "Accept", () => decide("accepted"), "button primary"), button(document, "Add Finding", () => textDialog(document, "Add Finding", "Describe the finding.", async (value) => { await actions.createFinding(sliceId, "finding", value); redraw(); })), button(document, "Add Question", () => textDialog(document, "Add Question", "Describe the question.", async (value) => { await actions.createFinding(sliceId, "question", value); redraw(); })), button(document, "Skip", () => textDialog(document, "Skip Slice", "Provide a skip reason.", async (value) => { await actions.skip(sliceId, value); redraw(); })), button(document, "Add Note", () => textDialog(document, "Add Note", "Enter a review note.", async (value) => { await actions.addNote(sliceId, value); redraw(); }), "button"), el(document, "div", "rail-divider"), button(document, "Previous", () => selectNeighbor(sliceIds, sliceId, -1, actions), "button"), button(document, "Next", () => selectNeighbor(sliceIds, sliceId, 1, actions), "button"));
  return rail;
}

function selectNeighbor(ids: readonly string[], id: string, direction: -1 | 1, actions: WorkspaceActions): void {
  const target = ids[ids.indexOf(id) + direction]; if (target) void actions.selectSlice(target);
}

export function textDialog(document: Document, title: string, hint: string, submit: (value: string) => void | Promise<void>): void {
  const opener = document.activeElement as HTMLElement | null; const dialog = document.createElement("dialog"); dialog.className = "text-dialog";
  const field = document.createElement("textarea"); field.className = "control"; field.setAttribute("aria-label", title); field.required = true;
  const close = (): void => { dialog.close(); dialog.remove(); opener?.focus(); };
  dialog.append(el(document, "form", "dialog-form", { method: "dialog" }, el(document, "p", "eyebrow", {}, "Review action"), el(document, "h2", "section-title", { id: "dialog-title" }, title), el(document, "p", "muted", {}, hint), field, el(document, "p", "field-hint", {}, "A value is required."), el(document, "div", "button-row", {}, button(document, "Cancel", close, "button"), button(document, "Save", () => { if (!field.value.trim()) { field.setAttribute("aria-invalid", "true"); field.focus(); return; } void Promise.resolve(submit(field.value.trim())).then(close); }, "button primary"))));
  dialog.setAttribute("aria-labelledby", "dialog-title"); document.body.append(dialog); dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); }); dialog.showModal(); field.focus();
}
