import type {
  ArtifactImportResult,
  ArtifactInput,
  ArtifactSlice,
  CompareOptions,
  DirectoryImportOptions,
  ImportFailureCode,
  ImportWarning,
  ManualMappingSet,
  ReviewerMapping,
  RevisionComparison,
  SlicingOptions,
} from "../capabilities/modules/mod.artifact-processing/src/index.ts";

interface SerializedArtifactError {
  code: ImportFailureCode;
  message: string;
  sourcePath: string;
  recovery: string;
}

type ArtifactIpcResult<T> =
  | { ok: true; value: T; diagnostics: ImportWarning[] }
  | { ok: false; error: SerializedArtifactError; diagnostics: ImportWarning[] };

type ArtifactSyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SerializedArtifactError };

interface DesktopArtifactBridge {
  importArtifact(input: ArtifactInput, options?: SlicingOptions): Promise<ArtifactIpcResult<ArtifactImportResult>>;
  importLocalArtifact(
    options?: SlicingOptions,
    directoryOptions?: DirectoryImportOptions,
  ): Promise<ArtifactIpcResult<ArtifactImportResult>>;
  compareRevisions(
    previous: readonly ArtifactSlice[],
    current: readonly ArtifactSlice[],
    options?: CompareOptions,
  ): Promise<ArtifactIpcResult<RevisionComparison>>;
  createManualMappingSet(
    previous: readonly ArtifactSlice[],
    current: readonly ArtifactSlice[],
    mappings: readonly ReviewerMapping[],
    recordedAt: string,
  ): ArtifactSyncResult<ManualMappingSet>;
  parseManualMappingSet(json: string): ArtifactSyncResult<ManualMappingSet>;
}

interface ReviewSliceDesktopBridge {
  readonly artifact: DesktopArtifactBridge;
  dataPath(): Promise<string>;
  saveFile(name: string, content: Uint8Array, mediaType: string): Promise<void>;
}

declare global {
  interface Window {
    reviewSliceDesktop?: ReviewSliceDesktopBridge;
  }
}

export type {
  ArtifactIpcResult,
  ArtifactSyncResult,
  ReviewSliceDesktopBridge,
  SerializedArtifactError,
};

export {};
