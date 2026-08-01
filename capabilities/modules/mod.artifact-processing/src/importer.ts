import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactImportResult, ArtifactInput, ArtifactKind, ArtifactSource, DirectoryImportOptions, ImportWarning, SlicingOptions } from "./contracts.ts"
import { hashOrderedFiles, normalizePath, sha256, stableIdentifier } from "./hash.ts"
import { detectKind, parseSource } from "./parsers.ts"
import { createSlices, type SliceWarning } from "./text.ts"

const defaultIgnoredNames = new Set([".git", "node_modules", ".DS_Store"])

export async function importArtifact(input: ArtifactInput, options: SlicingOptions = {}): Promise<ArtifactImportResult> {
  const sources = Array.isArray(input.source) ? [...input.source] : [input.source]
  const importedAt = input.importedAt ?? new Date().toISOString()
  const kind = input.kind ?? (sources.length > 1 ? "source-directory" : detectKind(sources[0]))
  const sourceHash = hashOrderedFiles(sources)
  const artifactId = stableIdentifier("artifact", `${input.displayName}:${sourceHash}`)
  const warnings: ImportWarning[] = []
  const slices = []
  for (const source of sources.sort((left, right) => normalizePath(left.relativePath).localeCompare(normalizePath(right.relativePath)))) {
    const sourceKind = kind === "source-directory" ? "source-directory" : (source.kind ?? kind)
    if (sourceKind !== "docx" && sourceKind !== "pdf" && isBinary(source.bytes)) { warnings.push({ code: "BINARY_FILE_SKIPPED", message: "Skip binary file.", sourcePath: source.relativePath, recovery: "Select a text file." }); continue }
    const raw = parseSource({ ...source, kind: sourceKind }, options.strategy, options, warnings)
    const sliceWarnings: SliceWarning[] = []
    slices.push(...createSlices(raw, artifactId, source.relativePath, sha256(source.bytes), importedAt, options, sliceWarnings))
    warnings.push(...sliceWarnings)
  }
  slices.forEach((slice, sequence) => { slice.sequence = sequence })
  return { artifact: { id: artifactId, displayName: input.displayName, kind, sourceHash, importedAt, sourcePaths: sources.map((source) => normalizePath(source.relativePath)) }, slices, warnings }
}

export async function importLocalPath(path: string, options: SlicingOptions = {}, directoryOptions: DirectoryImportOptions = {}): Promise<ArtifactImportResult> {
  let details
  try { details = await stat(path) } catch (cause) { throw new ArtifactImportError("FILE_READ_FAILED", "The selected path is unavailable.", path, "Select an available file or directory.", { cause }) }
  if (details.isDirectory()) {
    const sources = await readDirectorySources(path, directoryOptions)
    return importArtifact({ displayName: basename(path), source: sources, kind: "source-directory" }, options)
  }
  if (!details.isFile()) throw new ArtifactImportError("FILE_READ_FAILED", "The selected path is not a file.", path, "Select a regular file.")
  try { return await importArtifact({ displayName: basename(path), source: { displayName: basename(path), relativePath: basename(path), bytes: await readFile(path) } }, options) }
  catch (cause) { if (cause instanceof ArtifactImportError) throw cause; throw new ArtifactImportError("FILE_READ_FAILED", "The selected file cannot be read.", path, "Check file access and try again.", { cause }) }
}

async function readDirectorySources(root: string, options: DirectoryImportOptions): Promise<ArtifactSource[]> {
  const ignored = new Set([...(options.ignoredNames ?? []), ...defaultIgnoredNames]); const maximum = options.maximumFileBytes ?? 20 * 1024 * 1024
  const sources: ArtifactSource[] = []
  async function visit(folder: string): Promise<void> {
    let entries
    try { entries = await readdir(folder, { withFileTypes: true }) } catch (cause) { throw new ArtifactImportError("DIRECTORY_READ_FAILED", "The directory cannot be read.", folder, "Check directory access and try again.", { cause }) }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (ignored.has(entry.name)) continue
      const absolute = join(folder, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) { const details = await stat(absolute); if (details.size <= maximum) sources.push({ displayName: entry.name, relativePath: normalizePath(relative(root, absolute)), bytes: await readFile(absolute), kind: "source-directory" }) }
    }
  }
  await visit(root)
  return sources
}

function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8_192); let controls = 0
  for (let index = 0; index < limit; index += 1) { const value = bytes[index]; if (value === 0) return true; if (value < 7 || (value > 14 && value < 32)) controls += 1 }
  return limit > 0 && controls / limit > 0.2
}
