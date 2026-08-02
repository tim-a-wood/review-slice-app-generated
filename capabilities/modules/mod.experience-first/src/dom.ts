export type IconName =
  | "archive" | "arrow-left" | "arrow-right" | "book-open" | "check" | "chevron-down"
  | "circle-help" | "clipboard-check" | "columns" | "download" | "file-plus" | "files"
  | "filter" | "folder-open" | "git-compare" | "layout-dashboard" | "menu" | "message-square"
  | "moon" | "more-horizontal" | "panel-left-close" | "panel-left-open" | "plus" | "refresh-cw"
  | "search" | "settings-2" | "shield-check" | "sun" | "tag" | "trash-2" | "triangle-alert"
  | "x";

const paths: Record<IconName, string> = {
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7M19 12H5"/>',
  "arrow-right": '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  "book-open": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "circle-help": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4M12 18h.01"/>',
  "clipboard-check": '<rect width="14" height="18" x="5" y="3" rx="2"/><path d="M9 3V1h6v2m-6 9 2 2 4-4"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5M12 15V3"/>',
  "file-plus": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6M12 18v-6m-3 3h6"/>',
  files: '<path d="M20 7h-7a2 2 0 0 1-2-2V2M9 18H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l7 7v3"/><rect width="8" height="8" x="12" y="14" rx="1"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  "folder-open": '<path d="m6 14 1.5-3h13l-2.3 6.6a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v3"/>',
  "git-compare": '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9"/>',
  "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  "message-square": '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
  "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  "panel-left-close": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18m6-6-3-3 3-3"/>',
  "panel-left-open": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18m3 12 3-3-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  "refresh-cw": '<path d="M20 6v5h-5M4 18v-5h5M18.5 9a7 7 0 0 0-12-2L4 11m16 2-2.5 4a7 7 0 0 1-12 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "settings-2": '<path d="M20 7h-9M14 17H5M17 4v6M8 14v6"/>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3zM9 12l2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  tag: '<path d="M12.6 2.6H5a2.4 2.4 0 0 0-2.4 2.4v7.6L12 22l10-10z"/><circle cx="7.5" cy="7.5" r="1"/>',
  "trash-2": '<path d="M3 6h18m-2 0-1 14H6L5 6m3 0V3h8v3m-6 4v6m4-6v6"/>',
  "triangle-alert": '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3M12 9v4m0 4h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};

export function icon(name: IconName, label?: string): string {
  const accessible = label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"';
  return `<svg class="eui-icon" data-lucide="${name}" ${accessible} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function attribute(value: unknown): string { return escapeHtml(value); }

export interface PageHeadingOptions {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  actions?: string;
  className?: string;
}

/** Render the single visible page heading used by every workspace route. */
export function pageHeading(options: PageHeadingOptions): string {
  const classes = ["page-heading", options.actions ? "split-header" : "", options.className ?? ""]
    .filter(Boolean)
    .join(" ");
  return `<header class="${attribute(classes)}">
    <div>
      <p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
      <h1 class="page-title" data-page-title id="${attribute(options.id)}">${escapeHtml(options.title)}</h1>
      <p class="page-summary" data-page-summary>${escapeHtml(options.summary)}</p>
    </div>
    ${options.actions ? `<div class="header-actions">${options.actions}</div>` : ""}
  </header>`;
}

export function downloadInDocument(document: Document, name: string, content: Uint8Array, mediaType: string): void {
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  const blob = new Blob([buffer], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
