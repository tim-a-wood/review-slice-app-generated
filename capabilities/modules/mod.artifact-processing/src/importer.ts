import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactImportResult, ArtifactInput, ArtifactKind, ArtifactSource, DirectoryImportOptions, ImportWarning, SlicingOptions } from "./contracts.ts"
import { hashOrderedFiles, normalizePath, sha256, stableIdentifier } from "./hash.ts"
import { detectKind, parseSource } from "./parsers.ts"
import { createSlices, normalizeSlicingOptions, type SliceWarning } from "./text.ts"

const defaultIgnoredNames = new Set([".git", "node_modules", ".DS_Store", "dist", "release"])

export async function importArtifact(input: ArtifactInput, requestedOptions: SlicingOptions = {}): Promise<ArtifactImportResult> {
  const options = normalizeOptions(requestedOptions)
  const sources = (Array.isArray(input.source) ? [...input.source] : [input.source]).sort((left, right) => normalizePath(left.relativePath).localeCompare(normalizePath(right.relativePath), "en-US"))
  if (!sources.length) throw new ArtifactImportError("FILE_READ_FAILED", "No source was selected.", input.displayName, "Select a supported file or source directory.")
  const importedAt = input.importedAt ?? new Date().toISOString()
  const kind = input.kind ?? (sources.length > 1 ? "source-directory" : detectKind(sources[0]))
  const sourceHash = hashOrderedFiles(sources)
  const artifactId = stableIdentifier("artifact", `${kind}:${sourceHash}`)
  const warnings: ImportWarning[] = []
  const slices = []
  for (const source of sources) {
    const sourceKind: ArtifactKind = kind === "source-directory" ? "source-directory" : (source.kind ?? kind)
    if (sourceKind !== "docx" && sourceKind !== "pdf" && isBinary(source.bytes)) {
      warnings.push({ code: "BINARY_FILE_SKIPPED", message: "A binary file was skipped.", sourcePath: source.relativePath, recovery: "Select a supported text source." }); continue
    }
    const parsed = parseSource({ ...source, kind: sourceKind }, options, warnings)
    const sliceWarnings: SliceWarning[] = []
    slices.push(...createSlices(parsed.slices, artifactId, source.relativePath, sha256(source.bytes), importedAt, options, sliceWarnings, parsed.text, parsed.coordinateSystem))
    warnings.push(...sliceWarnings)
  }
  slices.forEach((slice, sequence) => { slice.sequence = sequence })
  const excludedSectionCount = warnings.filter((warning) => warning.code === "SLICE_EXCLUDED").length
  return {
    artifact: { id: artifactId, displayName: input.displayName, kind, sourceHash, importedAt, sourcePaths: sources.map((source) => normalizePath(source.relativePath)) },
    slices, warnings, slicing: options,
    preview: {
      sliceCount: slices.length,
      totalCharacters: slices.reduce((total, slice) => total + slice.content.length, 0),
      estimatedMinutes: Math.max(1, Math.ceil(slices.reduce((total, slice) => total + slice.content.length, 0) / 5_000)),
      oversizedSliceIds: slices.filter((slice) => slice.content.length > options.splitAboveCharacters).map((slice) => slice.id),
      emptySectionCount: warnings.filter((warning) => warning.code === "EMPTY_SOURCE").length,
      excludedSectionCount,
    },
  }
}

export async function importLocalPath(path: string, options: SlicingOptions = {}, directoryOptions: DirectoryImportOptions = {}): Promise<ArtifactImportResult> {
  let details
  try { details = await stat(path) } catch (cause) { throw new ArtifactImportError("FILE_READ_FAILED", "The selected path is unavailable.", path, "Select an available file or directory.", { cause }) }
  if (details.isDirectory()) {
    const { sources, warnings } = await readDirectorySources(path, directoryOptions)
    const result = await importArtifact({ displayName: basename(path), source: sources, kind: "source-directory" }, options)
    result.warnings.unshift(...warnings); return result
  }
  if (!details.isFile()) throw new ArtifactImportError("FILE_READ_FAILED", "The selected path is not a regular file.", path, "Select a regular file.")
  try { return await importArtifact({ displayName: basename(path), source: { displayName: basename(path), relativePath: basename(path), bytes: await readFile(path) } }, options) }
  catch (cause) { if (cause instanceof ArtifactImportError) throw cause; throw new ArtifactImportError("FILE_READ_FAILED", "The selected file cannot be read.", path, "Check file access and try again.", { cause }) }
}

async function readDirectorySources(root: string, options: DirectoryImportOptions): Promise<{ sources: ArtifactSource[]; warnings: ImportWarning[] }> {
  const ignored = new Set([...(options.ignoredNames ?? []), ...defaultIgnoredNames]); const maximum = options.maximumFileBytes ?? 20 * 1024 * 1024
  const sources: ArtifactSource[] = []; const warnings: ImportWarning[] = []
  async function visit(folder: string): Promise<void> {
    let entries
    try { entries = await readdir(folder, { withFileTypes: true }) } catch (cause) { throw new ArtifactImportError("DIRECTORY_READ_FAILED", "The directory cannot be read.", folder, "Check directory access and try again.", { cause }) }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"))) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue
      const absolute = join(folder, entry.name); const relativePath = normalizePath(relative(root, absolute))
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) {
        const details = await stat(absolute)
        if (details.size > maximum) warnings.push({ code: "FILE_TOO_LARGE_SKIPPED", message: "A source file exceeded the configured size limit.", sourcePath: relativePath, recovery: "Increase the local file-size limit or review the file separately." })
        else sources.push({ displayName: entry.name, relativePath, bytes: await readFile(absolute), kind: "source-directory" })
      }
    }
  }
  await visit(root)
  return { sources, warnings }
}

function normalizeOptions(options: SlicingOptions) {
  try { return normalizeSlicingOptions(options) }
  catch (cause) { throw new ArtifactImportError("INVALID_SLICING_OPTIONS", cause instanceof Error ? cause.message : "The slicing options are invalid.", "slicing-options", "Correct the slicing values and preview the artifact again.", { cause }) }
}
function isBinary(bytes: Uint8Array): boolean { const limit = Math.min(bytes.length, 8_192); let controls = 0; for (let index = 0; index < limit; index += 1) { const value = bytes[index]; if (value === 0) return true; if (value < 7 || (value > 14 && value < 32)) controls += 1 } return limit > 0 && controls / limit > 0.2 }
