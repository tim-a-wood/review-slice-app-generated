import { inflateRawSync, inflateSync } from "node:zlib"
import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactKind, ArtifactSource, ImportWarning, SliceStrategy, SlicingOptions } from "./contracts.ts"
import { decodeText, type RawSlice } from "./text.ts"

const decoder = new TextDecoder("utf-8", { fatal: false })
const textKinds: Record<string, ArtifactKind> = { md: "markdown", markdown: "markdown", txt: "text", text: "text", docx: "docx", pdf: "pdf", csv: "csv", json: "json", xml: "xml", diff: "diff", patch: "diff" }
const pdfEscapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as const
const namedEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as const

function hasKey<Value extends object>(value: Value, key: PropertyKey): key is keyof Value {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function detectKind(source: ArtifactSource): ArtifactKind {
  if (source.kind) return source.kind
  const extension = source.relativePath.split(".").at(-1)?.toLowerCase() ?? ""
  return textKinds[extension] ?? "text"
}

export function parseSource(source: ArtifactSource, strategy: SliceStrategy = "auto", options: SlicingOptions = {}, warnings: ImportWarning[] = []): RawSlice[] {
  const kind = detectKind(source)
  const text = kind === "docx" ? extractDocx(source) : kind === "pdf" ? extractPdf(source, warnings) : decodeText(source.bytes)
  if (!text.trim()) {
    warnings.push({ code: "EMPTY_SOURCE", message: "The source has no readable text.", sourcePath: source.relativePath, recovery: "Select a source with text." })
    return []
  }
  switch (kind) {
    case "markdown": return parseHeadings(text, strategy, options.headingDepth)
    case "csv": return parseCsv(text, source.relativePath)
    case "json": return parseJson(text, source.relativePath)
    case "xml": return parseXml(text, source.relativePath)
    case "diff": return parseDiff(text, source.relativePath)
    case "source-directory": return parseCode(text, source.relativePath, strategy)
    default: return parseText(text, strategy, options.manualBoundaries)
  }
}

function parseHeadings(text: string, strategy: SliceStrategy, maximumDepth = 6): RawSlice[] {
  if (strategy === "paragraph") return parseParagraphs(text)
  const headings = [...text.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].filter((match) => match[1].length <= maximumDepth)
  if (!headings.length) return parseText(text, "paragraph")
  return headings.map((heading, index) => ({ title: heading[2].trim(), content: text.slice(heading.index, headings[index + 1]?.index ?? text.length).trim(), startOffset: heading.index ?? 0, endOffset: headings[index + 1]?.index ?? text.length, locator: `heading:${heading[2].trim()}`, key: `heading:${heading[1].length}:${heading[2].trim().toLowerCase()}` }))
}

function parseText(text: string, strategy: SliceStrategy, boundaries?: readonly number[]): RawSlice[] {
  if (strategy === "manual" && boundaries?.length) {
    const points = [...new Set([0, ...boundaries.filter((point) => point > 0 && point < text.length), text.length])].sort((left, right) => left - right)
    return points.slice(0, -1).map((startOffset, index) => ({ title: `Manual slice ${index + 1}`, content: text.slice(startOffset, points[index + 1]).trim(), startOffset, endOffset: points[index + 1], locator: `offset:${startOffset}` })).filter((slice) => slice.content)
  }
  if (strategy === "paragraph" || strategy === "auto") return parseParagraphs(text)
  const sections = [...text.matchAll(/^(?:\d+(?:\.\d+)*|[A-Z]{2,}-\d+)\s+(.+)$/gm)]
  if (!sections.length) return [{ title: "Source text", content: text.trim(), startOffset: 0, endOffset: text.length, locator: "text:1" }]
  return sections.map((section, index) => ({ title: section[1].trim(), content: text.slice(section.index, sections[index + 1]?.index ?? text.length).trim(), startOffset: section.index ?? 0, endOffset: sections[index + 1]?.index ?? text.length, locator: `section:${section[0].trim().split(/\s+/)[0]}` }))
}

function parseParagraphs(text: string): RawSlice[] {
  return [...text.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)].map((match, index) => ({ title: `Paragraph ${index + 1}`, content: match[0].trim(), startOffset: match.index ?? 0, endOffset: (match.index ?? 0) + match[0].length, locator: `paragraph:${index + 1}` }))
}

function parseCsv(text: string, path: string): RawSlice[] {
  const rows = readCsv(text, path)
  if (!rows.length) return []
  const headers = rows[0]
  return rows.slice(1).map((row, index) => ({ title: `Row ${index + 1}`, content: JSON.stringify(Object.fromEntries(headers.map((header, column) => [header || `column_${column + 1}`, row[column] ?? ""])), null, 2), startOffset: index + 1, endOffset: index + 2, locator: `row:${index + 2}`, key: `row:${index + 2}` }))
}

function readCsv(text: string, path: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]; const next = text[index + 1]
    if (character === '"' && quoted && next === '"') { value += '"'; index += 1 } else if (character === '"') quoted = !quoted
    else if (character === "," && !quoted) { row.push(value); value = "" }
    else if (character === "\n" && !quoted) { row.push(value); rows.push(row); row = []; value = "" }
    else value += character
  }
  if (quoted) throw new ArtifactImportError("INVALID_CSV", "The CSV quote is not closed.", path, "Close the quote and import the file again.")
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows.filter((entry) => entry.some(Boolean))
}

function parseJson(text: string, path: string): RawSlice[] {
  let value: unknown
  try { value = JSON.parse(text) } catch (cause) { throw new ArtifactImportError("INVALID_JSON", "The JSON source is invalid.", path, "Correct the JSON syntax and import the file again.", { cause }) }
  const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : value && typeof value === "object" ? Object.entries(value as Record<string, unknown>) : [["value", value] as const]
  return entries.map(([key, entry], index) => ({ title: key, content: JSON.stringify(entry, null, 2), startOffset: index, endOffset: index + 1, locator: `json:${key}`, key: `json:${key}` }))
}

function parseXml(text: string, path: string): RawSlice[] {
  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<[^>]+>/.test(text)) throw new ArtifactImportError("INVALID_XML", "The XML source has no root element.", path, "Select valid XML and import the file again.")
  const root = text.match(/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<([\w:.-]+)[^>]*>([\s\S]*)<\/\1>\s*$/)
  if (!root) throw new ArtifactImportError("INVALID_XML", "The XML root is not closed.", path, "Close the root element and import the file again.")
  const children = [...root[2].matchAll(/<([\w:.-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<([\w:.-]+)(?:\s[^>]*)?\/>/g)]
  return (children.length ? children : [root]).map((entry, index) => { const tag = entry[1] || entry[3] || root[1]; const content = entry[0]; return { title: `${tag} ${index + 1}`, content, startOffset: (entry.index ?? 0), endOffset: (entry.index ?? 0) + content.length, locator: `xml:${tag}:${index + 1}`, key: `xml:${tag}:${index + 1}` } })
}

function parseDiff(text: string, path: string): RawSlice[] {
  const files = [...text.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)]
  if (!files.length) throw new ArtifactImportError("INVALID_DIFF", "The diff source has no file header.", path, "Select a unified diff and import the file again.")
  return files.flatMap((file, fileIndex) => { const block = text.slice(file.index, files[fileIndex + 1]?.index ?? text.length); const hunks = [...block.matchAll(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@.*$/gm)]; return hunks.length ? hunks.map((hunk, index) => ({ title: `${file[2]} hunk ${index + 1}`, content: block.slice(hunk.index, hunks[index + 1]?.index ?? block.length).trim(), startOffset: (file.index ?? 0) + (hunk.index ?? 0), endOffset: (file.index ?? 0) + (hunks[index + 1]?.index ?? block.length), locator: `diff:${file[2]}:${hunk[2]}`, key: `diff:${file[2]}:${hunk[2]}` })) : [{ title: file[2], content: block.trim(), startOffset: file.index ?? 0, endOffset: (files[fileIndex + 1]?.index ?? text.length), locator: `diff:${file[2]}`, key: `diff:${file[2]}` }] })
}

function parseCode(text: string, path: string, strategy: SliceStrategy): RawSlice[] {
  if (strategy === "file") return [{ title: path, content: text, startOffset: 0, endOffset: text.length, locator: "file:1", key: `file:${path}` }]
  const declarations = [...text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([\w$]+)/gm)]
  if (!declarations.length || strategy === "paragraph") return parseParagraphs(text)
  return declarations.map((declaration, index) => ({ title: declaration[1], content: text.slice(declaration.index, declarations[index + 1]?.index ?? text.length).trim(), startOffset: declaration.index ?? 0, endOffset: declarations[index + 1]?.index ?? text.length, locator: `symbol:${declaration[1]}`, key: `symbol:${declaration[1]}` }))
}

function extractDocx(source: ArtifactSource): string {
  let xml: Uint8Array
  try { xml = readZipEntry(source.bytes, "word/document.xml") } catch (cause) { throw new ArtifactImportError("INVALID_DOCX", "The DOCX package has no document XML.", source.relativePath, "Select a valid DOCX file and import it again.", { cause }) }
  const documentXml = decoder.decode(xml)
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((paragraph) => paragraph[0]
    .replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "").trim())
  const text = paragraphs.filter(Boolean).join("\n\n")
  if (!text) throw new ArtifactImportError("INVALID_DOCX", "The DOCX file has no readable text.", source.relativePath, "Select a DOCX file with document text.")
  return decodeEntities(text)
}

function readZipEntry(bytes: Uint8Array, requestedName: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findSignature(bytes, 0x06054b50)
  if (end < 0) throw new Error("ZIP end record missing")
  const directoryOffset = view.getUint32(end + 16, true); const entries = view.getUint16(end + 10, true)
  let cursor = directoryOffset
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP directory invalid")
    const method = view.getUint16(cursor + 10, true); const compressedSize = view.getUint32(cursor + 20, true); const nameLength = view.getUint16(cursor + 28, true); const extraLength = view.getUint16(cursor + 30, true); const commentLength = view.getUint16(cursor + 32, true); const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (name === requestedName) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP local record invalid")
      const localNameLength = view.getUint16(localOffset + 26, true); const localExtraLength = view.getUint16(localOffset + 28, true); const dataStart = localOffset + 30 + localNameLength + localExtraLength; const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return compressed
      if (method === 8) return inflateRawSync(compressed)
      throw new Error("ZIP compression unsupported")
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error("ZIP entry missing")
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = Math.max(0, bytes.length - 65_557); index <= bytes.length - 4; index += 1) if (view.getUint32(index, true) === signature) return index
  return -1
}

function extractPdf(source: ArtifactSource, warnings: ImportWarning[]): string {
  const raw = new TextDecoder("latin1").decode(source.bytes)
  if (!raw.startsWith("%PDF-")) throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF header is invalid.", source.relativePath, "Select a text-based PDF and import it again.")
  const streams: string[] = []
  const matcher = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  for (const match of raw.matchAll(matcher)) {
    let content = match[2]
    if (/\/FlateDecode/.test(match[1])) { try { content = new TextDecoder("latin1").decode(inflateSync(Buffer.from(content, "latin1"))) } catch { continue } }
    streams.push(extractPdfStrings(content))
  }
  const text = streams.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  if (!text) throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF has no supported text stream.", source.relativePath, "Use a text-based PDF with selectable text.")
  warnings.push({ code: "PDF_TEXT_LIMITED", message: "The PDF text uses supported text operators.", sourcePath: source.relativePath, recovery: "Check the preview before confirmation." })
  return text
}

function extractPdfStrings(stream: string): string {
  const pieces: string[] = []
  for (const block of stream.matchAll(/BT([\s\S]*?)ET/g)) for (const token of block[1].matchAll(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g)) pieces.push(decodePdfToken(token[0]))
  return pieces.filter(Boolean).join(" ")
}

function decodePdfToken(token: string): string {
  if (token.startsWith("<")) return Buffer.from(token.slice(1, -1).replace(/\s/g, ""), "hex").toString("latin1")
  return token.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_all, character: string) => hasKey(pdfEscapes, character) ? pdfEscapes[character] : character).replace(/\\([0-7]{1,3})/g, (_all, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
}

function decodeEntities(value: string): string { return value.replace(/&(amp|lt|gt|quot|apos);/g, (_all, entity: string) => hasKey(namedEntities, entity) ? namedEntities[entity] : entity) }
