import { normalizePath, sha256, stableIdentifier } from "./hash.ts"
import type { ArtifactSlice, SlicingOptions, SourceLocation } from "./contracts.ts"

export interface RawSlice { title: string; content: string; startOffset: number; endOffset: number; locator?: string; key?: string }
export interface SliceWarning { code: "SLICE_COMBINED" | "SLICE_SPLIT" | "SLICE_EXCLUDED"; message: string; sourcePath: string }

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}

export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < Math.min(offset, text.length); index += 1) if (text[index] === "\n") line += 1
  return line
}

export function createSlices(rawSlices: RawSlice[], artifactId: string, sourcePath: string, sourceHash: string, importedAt: string, options: SlicingOptions, warnings: SliceWarning[]): ArtifactSlice[] {
  const prepared = splitLargeSlices(combineSmallSlices(rawSlices, options, sourcePath, warnings), options, sourcePath, warnings)
  return prepared.flatMap((raw, sequence) => {
    const matchKey = raw.key ?? `${normalizePath(sourcePath)}:${slug(raw.title)}:${sequence + 1}`
    if (options.excludedMatchKeys?.has(matchKey) || options.excludedTitles?.includes(raw.title)) {
      warnings.push({ code: "SLICE_EXCLUDED", message: `Exclude slice ${raw.title}.`, sourcePath })
      return []
    }
    const location: SourceLocation = { path: normalizePath(sourcePath), startOffset: raw.startOffset, endOffset: raw.endOffset, startLine: lineAt(raw.content, 0), endLine: lineAt(raw.content, raw.content.length), locator: raw.locator }
    return [{ id: stableIdentifier("slice", matchKey), matchKey, artifactId, sourceHash, contentHash: sha256(raw.content), title: raw.title, content: raw.content, parentId: null, sequence, source: location, preview: { excerpt: raw.content.replace(/\s+/g, " ").trim().slice(0, 280), characterCount: raw.content.length, lineCount: raw.content ? raw.content.split("\n").length : 0 }, reviewState: "not-reviewed", revisionState: "added", findingIds: [], createdAt: importedAt, updatedAt: importedAt }]
  })
}

function combineSmallSlices(rawSlices: RawSlice[], options: SlicingOptions, sourcePath: string, warnings: SliceWarning[]): RawSlice[] {
  const minimum = options.combineBelowCharacters ?? 0
  if (!minimum) return rawSlices
  const combined: RawSlice[] = []
  for (const slice of rawSlices) {
    const prior = combined.at(-1)
    if (prior && slice.content.length < minimum) {
      prior.title = `${prior.title} · ${slice.title}`
      prior.content = `${prior.content}\n\n${slice.content}`
      prior.endOffset = slice.endOffset
      warnings.push({ code: "SLICE_COMBINED", message: `Combine slice ${slice.title}.`, sourcePath })
    } else combined.push({ ...slice })
  }
  return combined
}

function splitLargeSlices(rawSlices: RawSlice[], options: SlicingOptions, sourcePath: string, warnings: SliceWarning[]): RawSlice[] {
  const maximum = options.splitAboveCharacters ?? Number.MAX_SAFE_INTEGER
  if (maximum < 1) return rawSlices
  return rawSlices.flatMap((slice) => {
    if (slice.content.length <= maximum) return [slice]
    const parts = chunkText(slice.content, maximum)
    warnings.push({ code: "SLICE_SPLIT", message: `Split slice ${slice.title}.`, sourcePath })
    return parts.map((content, index) => ({ ...slice, title: `${slice.title} (${index + 1})`, content, startOffset: slice.startOffset + slice.content.indexOf(content), endOffset: slice.startOffset + slice.content.indexOf(content) + content.length, key: `${slice.key ?? slug(slice.title)}:${index + 1}` }))
  })
}

export function chunkText(text: string, maximum: number): string[] {
  const result: string[] = []
  let remaining = text.trim()
  while (remaining.length > maximum) {
    const breakAt = Math.max(remaining.lastIndexOf("\n\n", maximum), remaining.lastIndexOf("\n", maximum), remaining.lastIndexOf(" ", maximum))
    const point = breakAt > Math.floor(maximum / 2) ? breakAt : maximum
    result.push(remaining.slice(0, point).trim())
    remaining = remaining.slice(point).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

export function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96) || "slice" }
