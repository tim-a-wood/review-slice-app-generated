import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactImportResult, ArtifactProcessing, ArtifactProcessingResult, ImportWarning } from "./contracts.ts"
import { compareRevisions, createManualMappingSet, parseManualMappingSet } from "./compare.ts"
import { importArtifact, importLocalPath } from "./importer.ts"

export function createArtifactProcessing(): ArtifactProcessing {
  return {
    moduleId: "mod.artifact-processing",
    moduleVersion: "1.0.0",
    importArtifact: (input, options) => capture(() => importArtifact(input, options)),
    importLocalPath: (path, options, directoryOptions) => capture(() => importLocalPath(path, options, directoryOptions)),
    compareRevisions: (previous, current, options) => capture(() => compareRevisions(previous, current, options)),
    createManualMappingSet,
    parseManualMappingSet,
  }
}

async function capture<T>(operation: () => Promise<T>): Promise<ArtifactProcessingResult<T>> {
  try {
    const value = await operation()
    const diagnostics = isImportResult(value) ? value.warnings : []
    return { ok: true, value, diagnostics }
  } catch (cause) {
    const error = cause instanceof ArtifactImportError ? cause : new ArtifactImportError("FILE_READ_FAILED", cause instanceof Error ? cause.message : "Artifact processing failed.", "artifact-processing", "Review the diagnostic and retry without changing the source.", { cause })
    const diagnostic: ImportWarning = { code: "UNSUPPORTED_FILE", message: error.message, sourcePath: error.sourcePath, recovery: error.recovery }
    return { ok: false, error, diagnostics: [diagnostic] }
  }
}
function isImportResult(value: unknown): value is ArtifactImportResult { return Boolean(value && typeof value === "object" && "artifact" in value && "slices" in value && "warnings" in value) }
