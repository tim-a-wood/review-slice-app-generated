import type { WorkspacePage, WorkspaceState } from "./contracts.ts";
import { button, el } from "./dom.ts";

const pages: readonly [WorkspacePage, string, string][] = [
  ["dashboard", "Dashboard", "D"], ["import", "Import", "I"], ["review", "Review", "R"], ["revisions", "Revisions", "V"], ["mappings", "Mappings", "M"], ["findings", "Findings", "F"], ["exports", "Exports", "E"],
];

export function renderShell(
  root: HTMLElement,
  state: WorkspaceState,
  collapsed: boolean,
  changePage: (page: WorkspacePage) => void,
  toggle: () => void,
  content: HTMLElement,
): void {
  const document = root.ownerDocument;
  const shell = el(document, "div", `review-slice ${collapsed ? "nav-collapsed" : ""}`);
  const nav = el(document, "nav", "primary-nav", { "aria-label": "Primary navigation" });
  nav.append(el(document, "div", "app-mark", {}, el(document, "span", "app-mark-icon", {}, "RS"), el(document, "span", "app-mark-text", {}, "Review Slice")));
  const list = el(document, "div", "nav-list");
  for (const [page, label, mark] of pages) {
    const item = button(document, label, () => changePage(page), `nav-item ${state.page === page ? "is-active" : ""}`);
    item.setAttribute("aria-current", state.page === page ? "page" : "false");
    item.setAttribute("title", label);
    item.prepend(el(document, "span", "nav-mark", { "aria-hidden": "true" }, mark));
    list.append(item);
  }
  nav.append(list, button(document, collapsed ? "Expand navigation" : "Collapse navigation", toggle, "nav-toggle"));
  const main = el(document, "main", "workspace-canvas", { tabindex: "-1" });
  main.append(renderHeader(document, state), content);
  shell.append(nav, main); root.replaceChildren(shell);
}

function renderHeader(document: Document, state: WorkspaceState): HTMLElement {
  const title = state.page[0].toUpperCase() + state.page.slice(1);
  const save = state.status === "loading" ? "Saving local data" : state.status === "error" ? "Action needs attention" : state.savedAt ? `Saved ${new Date(state.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Local workspace";
  return el(document, "header", "page-header", {}, el(document, "div", "header-title", {}, el(document, "p", "eyebrow", {}, "Review Slice"), el(document, "h1", "page-title", {}, title)), el(document, "p", `save-state ${state.status === "error" ? "is-error" : ""}`, { role: "status", "aria-live": "polite" }, save));
}
