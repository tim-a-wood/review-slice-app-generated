export type Child = HTMLElement | string | undefined;

export function el(
  document: Document,
  tag: string,
  className = "",
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, value);
  }
  for (const child of children) if (child !== undefined) node.append(child);
  return node;
}

export function button(
  document: Document,
  label: string,
  action: () => void | Promise<void>,
  className = "button",
  disabled = false,
): HTMLButtonElement {
  const node = el(document, "button", className, { type: "button", disabled }) as HTMLButtonElement;
  node.textContent = label;
  node.addEventListener("click", () => void action());
  return node;
}

export function input(
  document: Document,
  label: string,
  value: string,
  change: (value: string) => void,
  options: { placeholder?: string; type?: string; className?: string } = {},
): HTMLElement {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const control = el(document, "input", "control", { id, type: options.type ?? "text", value, placeholder: options.placeholder }) as HTMLInputElement;
  control.addEventListener("input", () => change(control.value));
  return el(document, "label", options.className ?? "field", { for: id }, el(document, "span", "field-label", {}, label), control, el(document, "span", "field-hint", {}, ""));
}

export function select(
  document: Document,
  label: string,
  value: string,
  values: readonly string[],
  change: (value: string) => void,
): HTMLElement {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const control = el(document, "select", "control", { id }) as HTMLSelectElement;
  for (const option of values) control.append(el(document, "option", "", { value: option, selected: option === value }, option));
  control.addEventListener("change", () => change(control.value));
  return el(document, "label", "field", { for: id }, el(document, "span", "field-label", {}, label), control, el(document, "span", "field-hint", {}, ""));
}

export function empty(document: Document, title: string, hint: string, action?: HTMLElement): HTMLElement {
  return el(document, "section", "empty-state", {}, el(document, "h2", "section-title", {}, title), el(document, "p", "muted", {}, hint), action);
}
