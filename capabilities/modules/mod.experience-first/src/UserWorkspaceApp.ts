import type { UserWorkspace, WorkspaceActions, WorkspacePage, WorkspaceState } from "./contracts.ts";
import { renderDashboard, renderImport } from "./dashboard-import.ts";
import { el } from "./dom.ts";
import { renderFindings, renderExports } from "./findings-exports.ts";
import { renderMappings, renderRevisions } from "./revisions.ts";
import { renderReview, textDialog } from "./review.ts";
import { renderShell } from "./shell.ts";
import { getActiveSlice } from "./view-model.ts";

export function mountUserWorkspace(root: HTMLElement, actions: WorkspaceActions): UserWorkspace {
  let state: WorkspaceState; let page: WorkspacePage; let collapsed = root.ownerDocument.defaultView?.localStorage.getItem("review-slice-nav-collapsed") === "true";
  let transientError = "";
  const setPage = (next: WorkspacePage): void => { page = next; draw(); };
  const toggle = (): void => { collapsed = !collapsed; root.ownerDocument.defaultView?.localStorage.setItem("review-slice-nav-collapsed", String(collapsed)); draw(); };
  const run = (work: () => void | Promise<void>): void => { transientError = ""; Promise.resolve(work()).then(draw).catch((error: unknown) => { transientError = error instanceof Error ? error.message : "The action did not finish."; draw(); }); };
  const draw = (): void => {
    const visible = { ...state, page, error: transientError || state.error, status: transientError ? "error" as const : state.status };
    const document = root.ownerDocument; let content: HTMLElement;
    if (page === "dashboard") content = renderDashboard(document, visible, actions, setPage);
    else if (page === "import") content = renderImport(document, visible, actions);
    else if (page === "review") content = renderReview(document, visible, actions, draw);
    else if (page === "revisions") content = renderRevisions(document, visible, actions, setPage);
    else if (page === "mappings") content = renderMappings(document, visible, actions);
    else if (page === "findings") content = renderFindings(document, visible, actions);
    else content = renderExports(document, visible, actions);
    if (visible.error) content.prepend(el(document, "section", "validation-summary", { role: "alert" }, el(document, "h2", "section-title", {}, "Resolve action"), el(document, "p", "", {}, visible.error)));
    renderShell(root, visible, collapsed, setPage, toggle, content);
  };
  const shortcut = (event: KeyboardEvent): void => {
    if (page !== "review" || event.altKey || event.ctrlKey || event.metaKey || isEditing(event.target)) return;
    const active = getActiveSlice(state.data); if (!active) return;
    const next = (direction: -1 | 1): void => { const index = state.data.slices.findIndex((slice) => slice.id === active.id); const slice = state.data.slices[index + direction]; if (slice) run(() => actions.selectSlice(slice.id)); };
    const key = event.key.toLowerCase();
    if (key === "a") run(() => actions.decide(active.id, "accepted"));
    else if (key === "f") textDialog(root.ownerDocument, "Add Finding", "Describe the finding.", async (value) => { await actions.createFinding(active.id, "finding", value); draw(); });
    else if (key === "q") textDialog(root.ownerDocument, "Add Question", "Describe the question.", async (value) => { await actions.createFinding(active.id, "question", value); draw(); });
    else if (key === "s") textDialog(root.ownerDocument, "Skip Slice", "Provide a skip reason.", async (value) => { await actions.skip(active.id, value); draw(); });
    else if (key === "j") next(1);
    else if (key === "k") next(-1);
    else return;
    event.preventDefault();
  };
  root.ownerDocument.addEventListener("keydown", shortcut);
  return { render(next: WorkspaceState): void { state = next; page = next.page; draw(); }, destroy(): void { root.ownerDocument.removeEventListener("keydown", shortcut); root.replaceChildren(); } };
}

function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
}
