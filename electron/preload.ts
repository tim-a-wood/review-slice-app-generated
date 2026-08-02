import { contextBridge, ipcRenderer } from "electron";
import type {
  ArtifactImportResult,
  ArtifactInput,
  ArtifactSlice,
  CompareOptions,
  DirectoryImportOptions,
  ManualMappingSet,
  ReviewerMapping,
  RevisionComparison,
  SlicingOptions,
} from "../capabilities/modules/mod.artifact-processing/src/index.ts";
import type {
  ArtifactIpcResult,
  ArtifactSyncResult,
  ReviewSliceDesktopBridge,
} from "../src/types.ts";

const api: ReviewSliceDesktopBridge = Object.freeze({
  artifact: Object.freeze({
    importArtifact: (input: ArtifactInput, options?: SlicingOptions) => (
      ipcRenderer.invoke("review-slice:artifact-import", input, options) as Promise<ArtifactIpcResult<ArtifactImportResult>>
    ),
    importLocalArtifact: (options?: SlicingOptions, directoryOptions?: DirectoryImportOptions) => (
      ipcRenderer.invoke(
        "review-slice:artifact-import-local",
        options,
        directoryOptions,
      ) as Promise<ArtifactIpcResult<ArtifactImportResult>>
    ),
    compareRevisions: (
      previous: readonly ArtifactSlice[],
      current: readonly ArtifactSlice[],
      options?: CompareOptions,
    ) => ipcRenderer.invoke(
      "review-slice:artifact-compare",
      previous,
      current,
      options,
    ) as Promise<ArtifactIpcResult<RevisionComparison>>,
    createManualMappingSet: (
      previous: readonly ArtifactSlice[],
      current: readonly ArtifactSlice[],
      mappings: readonly ReviewerMapping[],
      recordedAt: string,
    ) => ipcRenderer.sendSync(
      "review-slice:mapping-create",
      previous,
      current,
      mappings,
      recordedAt,
    ) as ArtifactSyncResult<ManualMappingSet>,
    parseManualMappingSet: (json: string) => ipcRenderer.sendSync(
      "review-slice:mapping-parse",
      json,
    ) as ArtifactSyncResult<ManualMappingSet>,
  }),
  dataPath: () => ipcRenderer.invoke("review-slice:data-path") as Promise<string>,
  saveFile: (name: string, content: Uint8Array, mediaType: string) => (
    ipcRenderer.invoke("review-slice:save-file", name, content, mediaType) as Promise<void>
  ),
});

contextBridge.exposeInMainWorld("reviewSliceDesktop", api);
