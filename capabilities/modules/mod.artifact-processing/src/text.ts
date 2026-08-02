import { normalizePath, sha256, stableIdentifier } from "./hash.ts"
import type { ArtifactSlice, CoordinateSystem, NormalizedSlicingOptions, SlicingOptions, SourceLocation } from "./contracts.ts"

export interface RawSlice {
  title: string
  content: string
  startOffset: number
  endOffset: number
  locator?: string
  key?: string
  parentKey?: string
}
export interface SliceWarning { code: "SLICE_COMBINED" | "SLICE_SPLIT" | "SLICE_EXCLUDED"; message: string; sourcePath: string }

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}

export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < Math.max(0, Math.min(offset, text.length)); index += 1) if (text[index] === "\n") line += 1
  return line
}

export function normalizeSlicingOptions(options: SlicingOptions = {}): NormalizedSlicingOptions {
  const headingDepth = finiteInteger(options.headingDepth ?? 6, 1, 6, "headingDepth")
  const combineBelowCharacters = finiteInteger(options.combineBelowCharacters ?? 0, 0, 1_000_000, "combineBelowCharacters")
  const splitAboveCharacters = finiteInteger(options.splitAboveCharacters ?? 4_000, 1, 20_000_000, "splitAboveCharacters")
  if (combineBelowCharacters >= splitAboveCharacters && combineBelowCharacters > 0) throw new RangeError("combineBelowCharacters must be smaller than splitAboveCharacters.")
  const manualBoundaries = [...new Set(options.manualBoundaries ?? [])].map((value) => finiteInteger(value, 1, Number.MAX_SAFE_INTEGER, "manualBoundaries")).sort((a, b) => a - b)
  return {
    strategy: options.strategy ?? "auto",
    headingDepth,
    combineBelowCharacters,
    splitAboveCharacters,
    manualBoundaries,
    excludedMatchKeys: [...(options.excludedMatchKeys ?? [])].sort(),
    excludedTitles: [...new Set(options.excludedTitles ?? [])].sort(),
  }
}

function finiteInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is outside its supported range.`)
  return value
}

export function createSlices(
  rawSlices: RawSlice[], artifactId: string, sourcePath: string, sourceHash: string, importedAt: string,
  options: NormalizedSlicingOptions, warnings: SliceWarning[], sourceText: string, coordinateSystem: CoordinateSystem,
): ArtifactSlice[] {
  const combined = combineSmallSlices(rawSlices, options, sourcePath, warnings, sourceText)
  const prepared = splitLargeSlices(combined, options, sourcePath, warnings)
  const occurrence = new Map<string, number>()
  const candidates = prepared.map((raw) => {
    const structural = raw.key ?? `${slug(raw.title)}`
    const baseKey = `${normalizePath(sourcePath)}:${structural}`
    const ordinal = (occurrence.get(baseKey) ?? 0) + 1
    occurrence.set(baseKey, ordinal)
    return { raw, matchKey: ordinal === 1 ? baseKey : `${baseKey}:occurrence-${ordinal}` }
  })
  const excludedKeys = new Set(options.excludedMatchKeys)
  const included = candidates.filter(({ raw, matchKey }) => {
    const excluded = excludedKeys.has(matchKey) || options.excludedTitles.includes(raw.title)
    if (excluded) warnings.push({ code: "SLICE_EXCLUDED", message: `Excluded slice ${raw.title}.`, sourcePath })
    return !excluded
  })
  const idsByKey = new Map(included.map(({ matchKey }) => [matchKey, stableIdentifier("slice", `${artifactId}:${matchKey}`)]))
  return included.map(({ raw, matchKey }, sequence) => {
    const startOffset = clamp(raw.startOffset, 0, sourceText.length)
    const endOffset = clamp(raw.endOffset, startOffset, sourceText.length)
    const location: SourceLocation = {
      path: normalizePath(sourcePath), startOffset, endOffset,
      startLine: lineAt(sourceText, startOffset), endLine: lineAt(sourceText, Math.max(startOffset, endOffset - 1)),
      locator: raw.locator, coordinateSystem,
    }
    const parentMatchKey = raw.parentKey ? `${normalizePath(sourcePath)}:${raw.parentKey}` : undefined
    return {
      id: idsByKey.get(matchKey)!, matchKey, artifactId, sourceHash, contentHash: sha256(raw.content), title: raw.title,
      content: raw.content, parentId: parentMatchKey ? idsByKey.get(parentMatchKey) ?? null : null, sequence, source: location,
      preview: { excerpt: raw.content.replace(/\s+/g, " ").trim().slice(0, 280), characterCount: raw.content.length, lineCount: raw.content ? raw.content.split("\n").length : 0 },
      reviewState: "not-reviewed", revisionState: "added", findingIds: [], createdAt: importedAt, updatedAt: importedAt,
    }
  })
}

function combineSmallSlices(rawSlices: RawSlice[], options: NormalizedSlicingOptions, sourcePath: string, warnings: SliceWarning[], sourceText: string): RawSlice[] {
  if (!options.combineBelowCharacters) return rawSlices.map((slice) => ({ ...slice }))
  const combined: RawSlice[] = []
  for (const slice of rawSlices) {
    const prior = combined.at(-1)
    if (prior && slice.content.length < options.combineBelowCharacters && prior.endOffset <= slice.startOffset) {
      prior.title = `${prior.title} · ${slice.title}`
      prior.endOffset = slice.endOffset
      prior.content = sourceText.slice(prior.startOffset, prior.endOffset).trim()
      prior.key = `${prior.key ?? slug(prior.title)}+${slice.key ?? slug(slice.title)}`
      warnings.push({ code: "SLICE_COMBINED", message: `Combined slice ${slice.title}.`, sourcePath })
    } else combined.push({ ...slice })
  }
  return combined
}

function splitLargeSlices(rawSlices: RawSlice[], options: NormalizedSlicingOptions, sourcePath: string, warnings: SliceWarning[]): RawSlice[] {
  return rawSlices.flatMap((slice) => {
    if (slice.content.length <= options.splitAboveCharacters) return [slice]
    const ranges = chunkRanges(slice.content, options.splitAboveCharacters)
    warnings.push({ code: "SLICE_SPLIT", message: `Split slice ${slice.title}.`, sourcePath })
    return ranges.map(({ start, end }, index) => ({
      ...slice, title: `${slice.title} (${index + 1})`, content: slice.content.slice(start, end),
      startOffset: slice.startOffset + start, endOffset: slice.startOffset + end,
      locator: `${slice.locator ?? "slice"}:part-${index + 1}`, key: `${slice.key ?? slug(slice.title)}:part-${index + 1}`,
    }))
  })
}

export function chunkRanges(text: string, maximum: number): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = []
  let cursor = 0
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maximum)
    if (end < text.length) {
      const candidates = [text.lastIndexOf("\n\n", end), text.lastIndexOf("\n", end), text.lastIndexOf(" ", end)]
      const boundary = Math.max(...candidates)
      if (boundary > cursor + Math.floor(maximum / 2)) end = boundary
    }
    while (cursor < end && /\s/.test(text[cursor])) cursor += 1
    while (end > cursor && /\s/.test(text[end - 1])) end -= 1
    if (end > cursor) result.push({ start: cursor, end })
    cursor = Math.max(end, cursor + 1)
  }
  return result
}

export function trimSpan(text: string, start: number, end: number): { content: string; startOffset: number; endOffset: number } {
  let left = clamp(start, 0, text.length); let right = clamp(end, left, text.length)
  while (left < right && /\s/.test(text[left])) left += 1
  while (right > left && /\s/.test(text[right - 1])) right -= 1
  return { content: text.slice(left, right), startOffset: left, endOffset: right }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)) }
export function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96) || "slice" }
