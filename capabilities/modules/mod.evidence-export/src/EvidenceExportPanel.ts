import type { EvidenceExportData } from "./contracts.ts";
import { createEvidencePackage, createFindingsRegister } from "./evidence-export.ts";
import { createReviewSummary } from "./serialize.ts";

export interface EvidenceExportPanelOptions {
  getData: () => EvidenceExportData;
  saveFile: (name: string, content: Uint8Array, mediaType: string) => void;
  reportError?: (error: Error) => void;
}

export function mountEvidenceExportPanel(container: HTMLElement, options: EvidenceExportPanelOptions): () => void {
  const panel = document.createElement("section");
  panel.className = "evidence-export";
  panel.setAttribute("aria-labelledby", "evidence-export-title");
  panel.innerHTML = `
    <header class="evidence-export__header">
      <p class="evidence-export__eyebrow">Evidence</p>
      <h2 id="evidence-export-title">Evidence export</h2>
      <p>Export deterministic review records for local evidence storage.</p>
    </header>
    <div class="evidence-export__actions" aria-label="Evidence export actions">
      <button type="button" data-export="summary">Download summary</button>
      <button type="button" data-export="findings">Download findings</button>
      <button type="button" class="evidence-export__primary" data-export="package">Download package</button>
    </div>
    <p class="evidence-export__status" role="status" aria-live="polite"></p>
  `;
  const status = panel.querySelector<HTMLElement>(".evidence-export__status");
  const listener = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-export]");
    if (!button) return;
    try {
      const data = options.getData();
      const format = button.dataset.export;
      if (format === "summary") options.saveFile("review-summary.md", bytes(createReviewSummary(data)), "text/markdown;charset=utf-8");
      if (format === "findings") options.saveFile("findings.json", createFindingsRegister(data, "json"), "application/json;charset=utf-8");
      if (format === "package") options.saveFile("review-evidence.zip", createEvidencePackage(data).zip, "application/zip");
      if (status) status.textContent = "Export file ready.";
    } catch (error) {
      const exportError = error instanceof Error ? error : new Error("Evidence export failed.");
      if (status) status.textContent = exportError.message;
      options.reportError?.(exportError);
    }
  };
  panel.addEventListener("click", listener);
  container.replaceChildren(panel);
  return () => panel.removeEventListener("click", listener);
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
