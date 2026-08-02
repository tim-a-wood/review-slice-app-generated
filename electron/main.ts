import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_KINDS,
  ArtifactImportError,
  createArtifactProcessing,
  type ArtifactInput,
  type ArtifactProcessingResult,
  type ArtifactSlice,
  type CoordinateSystem,
  type DirectoryImportOptions,
  type ImportFailureCode,
  type ImportWarning,
} from "../capabilities/modules/mod.artifact-processing/src/index.ts";
import type { ArtifactIpcResult, ArtifactSyncResult, SerializedArtifactError } from "../src/types.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const artifact = createArtifactProcessing();
const coordinateSystems = new Set<CoordinateSystem>([
  "decoded-text",
  "extracted-docx-text",
  "extracted-pdf-text",
]);
const maximumSourceCount = 5_000;
const maximumSourceBytes = 100 * 1024 * 1024;
const maximumTotalBytes = 512 * 1024 * 1024;
const maximumSliceCount = 25_000;
let mainWindow: BrowserWindow | undefined;

function dataDirectory(): string {
  return join(app.getPath("userData"), "review-slice");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactImportError("FILE_READ_FAILED", `${label} is invalid.`, label, "Select the source again.");
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw new ArtifactImportError("FILE_READ_FAILED", `${label} is invalid.`, label, "Select the source again.");
  }
  return value;
}

function sourceBytes(value: unknown): Uint8Array {
  let bytes: Uint8Array;
  if (value instanceof Uint8Array) bytes = new Uint8Array(value);
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
  else throw new ArtifactImportError("FILE_READ_FAILED", "The source bytes are invalid.", "source", "Select the source again.");
  if (bytes.byteLength > maximumSourceBytes) {
    throw new ArtifactImportError("FILE_READ_FAILED", "The source exceeds the local size limit.", "source", "Review the source as a separate artifact.");
  }
  return bytes;
}

function normalizeArtifactInput(value: unknown): ArtifactInput {
  const record = asRecord(value, "artifact input");
  const values = Array.isArray(record.source) ? record.source : [record.source];
  if (!values.length || values.length > maximumSourceCount) {
    throw new ArtifactImportError("FILE_READ_FAILED", "The source count is invalid.", "source", "Select fewer source files.");
  }
  let totalBytes = 0;
  const sources = values.map((entry) => {
    const source = asRecord(entry, "artifact source");
    const bytes = sourceBytes(source.bytes);
    totalBytes += bytes.byteLength;
    const kind = source.kind;
    if (kind !== undefined && !ARTIFACT_KINDS.includes(kind as never)) {
      throw new ArtifactImportError("UNSUPPORTED_FORMAT", "The source type is not supported.", "source", "Select a supported source.");
    }
    return {
      displayName: boundedText(source.displayName, "source name", 512),
      relativePath: boundedText(source.relativePath, "source path"),
      bytes,
      ...(kind === undefined ? {} : { kind: kind as ArtifactInput["kind"] }),
    };
  });
  if (totalBytes > maximumTotalBytes) {
    throw new ArtifactImportError("FILE_READ_FAILED", "The selected sources exceed the local size limit.", "source", "Select fewer source files.");
  }
  const kind = record.kind;
  if (kind !== undefined && !ARTIFACT_KINDS.includes(kind as never)) {
    throw new ArtifactImportError("UNSUPPORTED_FORMAT", "The artifact type is not supported.", "artifact", "Select a supported source.");
  }
  return {
    displayName: boundedText(record.displayName, "artifact name", 512),
    source: Array.isArray(record.source) ? sources : sources[0],
    ...(kind === undefined ? {} : { kind: kind as ArtifactInput["kind"] }),
    ...(typeof record.importedAt === "string" ? { importedAt: record.importedAt } : {}),
  };
}

function normalizeSlices(value: unknown, label: string): ArtifactSlice[] {
  if (!Array.isArray(value) || value.length > maximumSliceCount) {
    throw new ArtifactImportError("INVALID_REVISION_MAPPING", `${label} is invalid.`, label, "Import the revision again.");
  }
  return value.map((entry) => {
    const slice = asRecord(entry, label);
    const source = asRecord(slice.source, `${label} source`);
    const supplied = source.coordinateSystem;
    const coordinateSystem: CoordinateSystem = coordinateSystems.has(supplied as CoordinateSystem)
      ? supplied as CoordinateSystem
      : "decoded-text";
    boundedText(slice.id, `${label} identifier`, 512);
    boundedText(slice.title, `${label} title`, 8_192);
    if (typeof slice.content !== "string" || slice.content.length > maximumSourceBytes) {
      throw new ArtifactImportError("INVALID_REVISION_MAPPING", `${label} content is invalid.`, label, "Import the revision again.");
    }
    return { ...slice, source: { ...source, coordinateSystem } } as unknown as ArtifactSlice;
  });
}

function serializedError(cause: unknown): SerializedArtifactError {
  const error = cause instanceof ArtifactImportError
    ? cause
    : new ArtifactImportError(
      "FILE_READ_FAILED",
      cause instanceof Error ? cause.message : "The application could not process the artifact.",
      "artifact-processing",
      "Review the diagnostic and try again.",
    );
  return {
    code: error.code as ImportFailureCode,
    message: error.message,
    sourcePath: error.sourcePath,
    recovery: error.recovery,
  };
}

function serializeResult<T>(result: ArtifactProcessingResult<T>): ArtifactIpcResult<T> {
  if (result.ok) return result;
  return { ok: false, error: serializedError(result.error), diagnostics: [...result.diagnostics] };
}

function failedResult<T>(cause: unknown): ArtifactIpcResult<T> {
  const error = serializedError(cause);
  const diagnostic: ImportWarning = {
    code: "UNSUPPORTED_FILE",
    message: error.message,
    sourcePath: error.sourcePath,
    recovery: error.recovery,
  };
  return { ok: false, error, diagnostics: [diagnostic] };
}

function assertTrusted(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) throw new Error("The desktop request is not trusted.");
}

function invoke<T extends unknown[], R>(operation: (...values: T) => Promise<R> | R) {
  return async (event: IpcMainInvokeEvent, ...values: T): Promise<R> => {
    assertTrusted(event);
    return operation(...values);
  };
}

function registerHandlers(): void {
  ipcMain.handle("review-slice:artifact-import", invoke(async (input: unknown, options: unknown) => {
    try {
      return serializeResult(await artifact.importArtifact(normalizeArtifactInput(input), options as never));
    } catch (cause) {
      return failedResult(cause);
    }
  }));
  ipcMain.handle("review-slice:artifact-import-local", invoke(async (options: unknown, directoryOptions: unknown) => {
    try {
      const owner = mainWindow;
      if (!owner) throw new Error("The application window is unavailable.");
      const selection = await dialog.showOpenDialog(owner, {
        properties: ["openFile", "openDirectory"],
        filters: [{
          name: "Review sources",
          extensions: ["md", "markdown", "txt", "docx", "pdf", "csv", "json", "xml", "diff", "patch"],
        }],
      });
      if (selection.canceled || !selection.filePaths[0]) {
        throw new ArtifactImportError("FILE_READ_FAILED", "No source was selected.", "source", "Select a local source.");
      }
      return serializeResult(await artifact.importLocalPath(
        selection.filePaths[0],
        options as never,
        directoryOptions as DirectoryImportOptions,
      ));
    } catch (cause) {
      return failedResult(cause);
    }
  }));
  ipcMain.handle("review-slice:artifact-compare", invoke(async (previous: unknown, current: unknown, options: unknown) => {
    try {
      return serializeResult(await artifact.compareRevisions(
        normalizeSlices(previous, "previous revision"),
        normalizeSlices(current, "current revision"),
        options as never,
      ));
    } catch (cause) {
      return failedResult(cause);
    }
  }));
  ipcMain.on("review-slice:mapping-create", (event, previous: unknown, current: unknown, mappings: unknown, recordedAt: unknown) => {
    try {
      assertTrusted(event);
      if (!Array.isArray(mappings) || typeof recordedAt !== "string") throw new Error("The mapping input is invalid.");
      event.returnValue = {
        ok: true,
        value: artifact.createManualMappingSet(
          normalizeSlices(previous, "previous revision"),
          normalizeSlices(current, "current revision"),
          mappings as never,
          recordedAt,
        ),
      } satisfies ArtifactSyncResult<unknown>;
    } catch (cause) {
      event.returnValue = { ok: false, error: serializedError(cause) } satisfies ArtifactSyncResult<unknown>;
    }
  });
  ipcMain.on("review-slice:mapping-parse", (event, json: unknown) => {
    try {
      assertTrusted(event);
      if (typeof json !== "string" || json.length > 10 * 1024 * 1024) throw new Error("The mapping file is invalid.");
      event.returnValue = { ok: true, value: artifact.parseManualMappingSet(json) } satisfies ArtifactSyncResult<unknown>;
    } catch (cause) {
      event.returnValue = { ok: false, error: serializedError(cause) } satisfies ArtifactSyncResult<unknown>;
    }
  });
  ipcMain.handle("review-slice:data-path", invoke(async () => {
    const location = dataDirectory();
    await mkdir(location, { recursive: true });
    return location;
  }));
  ipcMain.handle("review-slice:save-file", invoke(async (name: unknown, content: unknown, mediaType: unknown) => {
    const safeName = basename(boundedText(name, "file name", 255));
    const bytes = sourceBytes(content);
    if (typeof mediaType !== "string" || mediaType.length > 255) throw new Error("The file type is invalid.");
    await mkdir(dataDirectory(), { recursive: true });
    const owner = mainWindow;
    if (!owner) throw new Error("The application window is unavailable.");
    const destination = await dialog.showSaveDialog(owner, { defaultPath: join(dataDirectory(), safeName) });
    if (destination.canceled || !destination.filePath) return;
    await writeFile(destination.filePath, bytes);
  }));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    webPreferences: {
      preload: join(moduleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = undefined; });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5173") {
      throw new Error("The development URL is not trusted.");
    }
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(moduleDirectory, "../dist/index.html"));
  }
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("com.reviewslice.desktop");
  void app.whenReady().then(() => {
    registerHandlers();
    mainWindow = createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
  });
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
