import type { ProcessingViewActions, ProcessingViewState, SliceStrategy } from "./contracts.ts"

const phases = ["Select Artifact", "Detect Structure", "Preview Slices", "Confirm Project"]
const strategies: SliceStrategy[] = ["auto", "heading", "paragraph", "row", "object", "element", "file", "function", "diff-hunk", "manual"]

export interface ArtifactProcessingView { render(state: ProcessingViewState): void; destroy(): void }

export function mountArtifactProcessing(root: HTMLElement, actions: ProcessingViewActions): ArtifactProcessingView {
  const render = (state: ProcessingViewState): void => {
    root.replaceChildren()
    const document = root.ownerDocument
    const shell = element(document, "section", "artifact-processing", { "aria-labelledby": "artifact-processing-title" })
    shell.append(element(document, "header", "artifact-header", {}, element(document, "p", "artifact-kicker", {}, "Artifact processing"), element(document, "h1", "artifact-title", { id: "artifact-processing-title" }, "Import Artifact"), element(document, "p", "artifact-description", {}, "Create source-linked slices before project confirmation.")))
    shell.append(renderSteps(document, state.phase))
    if (state.error) shell.append(renderError(document, state, actions))
    else shell.append(renderForm(document, state, actions))
    root.append(shell)
  }
  return { render, destroy: () => root.replaceChildren() }
}

function renderSteps(document: Document, phase: ProcessingViewState["phase"]): HTMLElement {
  const current = ["select", "detect", "preview", "confirm"].indexOf(phase)
  const list = element(document, "ol", "artifact-steps", { "aria-label": "Import steps" })
  phases.forEach((name, index) => list.append(element(document, "li", index === current ? "is-current" : index < current ? "is-complete" : "", { "aria-current": index === current ? "step" : undefined }, `${index + 1}. ${name}`)))
  return list
}

function renderError(document: Document, state: ProcessingViewState, actions: ProcessingViewActions): HTMLElement {
  const alert = element(document, "section", "artifact-alert", { role: "alert", "aria-live": "assertive" })
  alert.append(element(document, "h2", "artifact-section-title", {}, "Resolve Import"), element(document, "p", "", {}, state.error!.message), element(document, "p", "artifact-hint", {}, state.error!.recovery), button(document, "Retry Import", () => actions.retryImport(), state.busy))
  return alert
}

function renderForm(document: Document, state: ProcessingViewState, actions: ProcessingViewActions): HTMLElement {
  const form = element(document, "div", "artifact-form")
  const select = element(document, "section", "artifact-group", { "aria-labelledby": "select-artifact" })
  select.append(element(document, "h2", "artifact-section-title", { id: "select-artifact" }, "Select Artifact"), element(document, "p", "artifact-hint", {}, state.artifactName ?? "Select a local artifact or source directory."))
  const actionsRow = element(document, "div", "artifact-actions")
  actionsRow.append(button(document, "Choose File", () => actions.selectFile(), state.busy), button(document, "Choose Directory", () => actions.selectDirectory(), state.busy), button(document, "Detect Structure", () => actions.detectStructure(), state.busy || !state.artifactName))
  select.append(actionsRow); form.append(select)
  const controls = element(document, "section", "artifact-group", { "aria-labelledby": "configure-slices" })
  controls.append(element(document, "h2", "artifact-section-title", { id: "configure-slices" }, "Configure Slices"), control(document, "Slice strategy", "strategy", state.options.strategy ?? "auto", strategies, (value) => actions.previewSlices({ ...state.options, strategy: value as SliceStrategy })), numberControl(document, "Heading depth", "headingDepth", state.options.headingDepth ?? 3, (value) => actions.previewSlices({ ...state.options, headingDepth: value })), numberControl(document, "Combine limit", "combineBelowCharacters", state.options.combineBelowCharacters ?? 0, (value) => actions.previewSlices({ ...state.options, combineBelowCharacters: value })), numberControl(document, "Split limit", "splitAboveCharacters", state.options.splitAboveCharacters ?? 2000, (value) => actions.previewSlices({ ...state.options, splitAboveCharacters: value })))
  form.append(controls)
  if (state.result) form.append(renderPreview(document, state, actions))
  return form
}

function renderPreview(document: Document, state: ProcessingViewState, actions: ProcessingViewActions): HTMLElement {
  const result = state.result!; const preview = element(document, "section", "artifact-preview", { "aria-labelledby": "preview-slices" })
  preview.append(element(document, "div", "artifact-summary", {}, element(document, "h2", "artifact-section-title", { id: "preview-slices" }, "Preview Slices"), element(document, "p", "artifact-hint", {}, `${result.slices.length} slices from ${result.artifact.displayName}.`)))
  const table = element(document, "table", "artifact-table"); table.append(element(document, "thead", "", {}, element(document, "tr", "", {}, element(document, "th", "", { scope: "col" }, "Slice"), element(document, "th", "", { scope: "col" }, "Source"), element(document, "th", "", { scope: "col" }, "Preview"))))
  const body = element(document, "tbody"); for (const slice of result.slices.slice(0, 100)) body.append(element(document, "tr", "", {}, element(document, "td", "", { title: slice.title }, slice.title), element(document, "td", "artifact-path", { title: slice.source.path }, slice.source.path), element(document, "td", "", {}, slice.preview.excerpt)))
  table.append(body); preview.append(table)
  if (result.slices.length > 100) preview.append(element(document, "p", "artifact-hint", {}, "Show the first 100 slices."))
  if (result.warnings.length) preview.append(element(document, "p", "artifact-warning", { role: "status" }, `${result.warnings.length} import warnings require review.`))
  preview.append(button(document, "Confirm Project", () => actions.confirmProject(), state.busy))
  return preview
}

function control(document: Document, label: string, name: string, value: string, values: readonly string[], change: (value: string) => void): HTMLElement { const field = element(document, "label", "artifact-field", {}, element(document, "span", "", {}, label)); const select = element(document, "select", "", { name, value }) as HTMLSelectElement; values.forEach((item) => select.append(element(document, "option", "", { value: item, selected: item === value ? "selected" : undefined }, item))); select.addEventListener("change", () => change(select.value)); field.append(select, element(document, "span", "artifact-slot", {}, " ")); return field }
function numberControl(document: Document, label: string, name: string, value: number, change: (value: number) => void): HTMLElement { const field = element(document, "label", "artifact-field", {}, element(document, "span", "", {}, label)); const input = element(document, "input", "", { name, type: "number", min: "0", value: String(value) }) as HTMLInputElement; input.addEventListener("change", () => change(Math.max(0, Number(input.value) || 0))); field.append(input, element(document, "span", "artifact-slot", {}, " ")); return field }
function button(document: Document, label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement { const control = element(document, "button", "artifact-button", { type: "button", disabled: disabled ? "disabled" : undefined }, label) as HTMLButtonElement; control.addEventListener("click", () => void action()); return control }
function element(document: Document, tag: string, className = "", attributes: Record<string, string | undefined> = {}, ...children: (HTMLElement | string)[]): HTMLElement { const node = document.createElement(tag); node.className = className; for (const [name, value] of Object.entries(attributes)) if (value !== undefined) node.setAttribute(name, value); for (const child of children) node.append(child); return node }
