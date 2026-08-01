import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareRevisions } from "../capabilities/modules/mod.artifact-processing/src/compare.ts";
import type { ArtifactSlice } from "../capabilities/modules/mod.artifact-processing/src/contracts.ts";
import { importLocalPath } from "../capabilities/modules/mod.artifact-processing/src/importer.ts";
import { createEvidencePackage } from "../capabilities/modules/mod.evidence-export/src/evidence-export.ts";
import type { ReviewState as EvidenceReviewState, RevisionState as EvidenceRevisionState } from "../capabilities/modules/mod.evidence-export/src/contracts.ts";
import { createDemo } from "../src/demo.ts";
import { applyRevision } from "../src/model.ts";
import type { AppState, RevisionState, Slice } from "../src/types.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const dataDirectory = join(app.getPath("userData"), "review-slice");
const stateFile = join(dataDirectory, "review-state.json");
const backupFile = join(dataDirectory, "review-state.backup.json");
const states = ["unchanged", "modified", "added", "removed", "relocated", "unmatched"] as const;

async function readState(): Promise<AppState> {
  try { return JSON.parse(await readFile(stateFile, "utf8")) as AppState; }
  catch { try { return JSON.parse(await readFile(backupFile, "utf8")) as AppState; } catch { const state = createDemo(dataDirectory); await writeState(state); return state; } }
}

async function writeState(state: AppState): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const content = JSON.stringify({ ...state, dataPath: dataDirectory }, null, 2);
  const temporary = `${stateFile}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, stateFile);
  await writeFile(backupFile, content, "utf8");
}

function toSlice(slice: ArtifactSlice): Slice {
  const source = { ...slice.source };
  return { id: slice.id, title: slice.title, content: slice.content, location: `${source.path}:${source.startLine}-${source.endLine}`, sequence: slice.sequence + 1, reviewState: slice.reviewState, revisionState: slice.revisionState, findingIds: [...slice.findingIds], matchKey: slice.matchKey, artifactId: slice.artifactId, sourceHash: slice.sourceHash, contentHash: slice.contentHash, source };
}

function toArtifactSlice(slice: Slice): ArtifactSlice {
  const source = slice.source ?? { path: slice.location.split(":")[0] || "source", startOffset: 0, endOffset: slice.content.length, startLine: 1, endLine: slice.content.split("\n").length, locator: slice.location };
  return { id: slice.id, matchKey: slice.matchKey ?? slice.id, artifactId: slice.artifactId ?? "stored-artifact", sourceHash: slice.sourceHash ?? "stored-source", contentHash: slice.contentHash ?? `stored-${slice.id}`, title: slice.title, content: slice.content, parentId: null, sequence: slice.sequence - 1, source, preview: { excerpt: slice.content.replace(/\s+/g, " ").slice(0, 280), characterCount: slice.content.length, lineCount: source.endLine - source.startLine + 1 }, reviewState: slice.reviewState, revisionState: slice.revisionState, findingIds: [...slice.findingIds], createdAt: "", updatedAt: "" };
}

function firstImport(previous: AppState, imported: readonly ArtifactSlice[], projectName: string, importedAt: string): AppState {
  return { ...previous, projectName, slices: imported.map(toSlice), findings: [], activeSliceId: imported[0]?.id ?? "", updatedAt: importedAt, hasImportedArtifact: true, revision: { importedAt, counts: countsForFirstImport(imported.length) } };
}

async function chooseArtifact(): Promise<AppState | undefined> {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "openDirectory"], filters: [{ name: "Review sources", extensions: ["md", "markdown", "txt", "docx", "pdf", "csv", "json", "xml", "diff", "patch"] }] });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const imported = await importLocalPath(result.filePaths[0]);
  const previous = await readState();
  const importedAt = new Date().toISOString();
  const next = previous.hasImportedArtifact
    ? { ...applyRevision(previous, await revisionResult(previous, imported.slices), importedAt), projectName: imported.artifact.displayName }
    : firstImport(previous, imported.slices, imported.artifact.displayName, importedAt);
  await writeState(next);
  return { ...next, dataPath: dataDirectory };
}

async function revisionResult(previous: AppState, current: readonly ArtifactSlice[]) {
  const prior = previous.slices.filter((slice) => slice.revisionState !== "removed").map(toArtifactSlice);
  const comparison = await compareRevisions(prior, current);
  return { current: comparison.current.map(toSlice), removed: comparison.previous.filter((slice) => slice.revisionState === "removed").map(toSlice), mappings: comparison.mappings, counts: comparison.counts };
}

function countsForFirstImport(total: number): Record<RevisionState, number> {
  return Object.fromEntries(states.map((state) => [state, state === "added" ? total : 0])) as Record<RevisionState, number>;
}

async function exportEvidence(state: AppState): Promise<string> {
  const exportedAt = new Date().toISOString();
  const evidence = createEvidencePackage({
    project: { id: "local-review", name: state.projectName, dataLocation: dataDirectory }, revision: { id: "local-revision", label: "Current review", importedAt: state.revision?.importedAt ?? state.updatedAt }, reviewDates: { startedAt: state.updatedAt, exportedAt },
    sources: [{ id: "local-source", path: state.projectName, content: state.slices.map((slice) => slice.content).join("\n") }],
    slices: state.slices.map((slice) => ({ id: slice.id, matchKey: slice.matchKey ?? slice.id, title: slice.title, location: slice.location, sourceId: "local-source", sequence: slice.sequence, contentHash: slice.contentHash ?? `local-${slice.id}`, reviewState: evidenceReviewState(slice.reviewState), revisionState: evidenceRevisionState(slice.revisionState), skippedReason: slice.skipReason })),
    findings: state.findings.map((finding) => ({ id: finding.id, type: finding.type, description: finding.description, status: finding.status, sourceSliceId: finding.sliceId, sourceLocation: state.slices.find((slice) => slice.id === finding.sliceId)?.location ?? "Unknown", createdAt: finding.createdAt })), history: [],
  });
  const destination = await dialog.showSaveDialog({ defaultPath: join(dataDirectory, "review-evidence.zip"), filters: [{ name: "ZIP", extensions: ["zip"] }] });
  if (destination.canceled || !destination.filePath) return "Export canceled.";
  await writeFile(destination.filePath, evidence.zip);
  return `Saved evidence to ${destination.filePath}`;
}

function evidenceReviewState(value: Slice["reviewState"]): EvidenceReviewState { return ({ "not-reviewed": "Not Reviewed", accepted: "Accepted", finding: "Finding", question: "Question", skipped: "Skipped", "re-review-required": "Re-review Required" } as const)[value]; }
function evidenceRevisionState(value: Slice["revisionState"]): EvidenceRevisionState { return ({ unchanged: "Unchanged", modified: "Modified", added: "Added", removed: "Removed", relocated: "Relocated", unmatched: "Unmatched" } as const)[value]; }
function createWindow(): void { const window = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 680, backgroundColor: "#07111f", webPreferences: { preload: join(moduleDirectory, "preload.js"), contextIsolation: true, nodeIntegration: false } }); const developmentUrl = process.env.VITE_DEV_SERVER_URL; if (developmentUrl) void window.loadURL(developmentUrl); else void window.loadFile(join(moduleDirectory, "../dist/index.html")); }
app.whenReady().then(() => { ipcMain.handle("review:load", readState); ipcMain.handle("review:save", async (_event, state: AppState) => { await writeState(state); }); ipcMain.handle("review:import", chooseArtifact); ipcMain.handle("review:export", (_event, state: AppState) => exportEvidence(state)); ipcMain.handle("review:data-path", () => dataDirectory); createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
