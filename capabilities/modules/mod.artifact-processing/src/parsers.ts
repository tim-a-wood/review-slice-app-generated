import { inflateRawSync, inflateSync } from "node:zlib"
import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactKind, ArtifactSource, CoordinateSystem, ImportWarning, NormalizedSlicingOptions, SliceStrategy } from "./contracts.ts"
import { decodeText, slug, trimSpan, type RawSlice } from "./text.ts"

const decoder = new TextDecoder("utf-8", { fatal: false })
const textKinds: Record<string, ArtifactKind> = { md: "markdown", markdown: "markdown", txt: "text", text: "text", docx: "docx", pdf: "pdf", csv: "csv", json: "json", xml: "xml", diff: "diff", patch: "diff" }
const codeExtensions = new Set(["c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "kt", "m", "mm", "php", "py", "rb", "rs", "scss", "swift", "ts", "tsx", "vue", "yaml", "yml"])
const pdfEscapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as const
const namedEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as const

export interface ParsedSource { text: string; slices: RawSlice[]; coordinateSystem: CoordinateSystem }

export function detectKind(source: ArtifactSource): ArtifactKind {
  if (source.kind) return source.kind
  const extension = source.relativePath.split(".").at(-1)?.toLowerCase() ?? ""
  if (textKinds[extension]) return textKinds[extension]
  return codeExtensions.has(extension) ? "source-directory" : "text"
}

export function parseSource(source: ArtifactSource, options: NormalizedSlicingOptions, warnings: ImportWarning[] = []): ParsedSource {
  const kind = detectKind(source)
  const extracted = kind === "docx" ? { text: extractDocx(source), coordinateSystem: "extracted-docx-text" as const }
    : kind === "pdf" ? { text: extractPdf(source, warnings), coordinateSystem: "extracted-pdf-text" as const }
      : { text: decodeText(source.bytes), coordinateSystem: "decoded-text" as const }
  const text = extracted.text
  if (!text.trim()) {
    warnings.push({ code: "EMPTY_SOURCE", message: "The source has no readable text.", sourcePath: source.relativePath, recovery: "Select a source that contains text." })
    return { ...extracted, slices: [] }
  }
  if (options.strategy === "manual") return { ...extracted, slices: parseManual(text, options.manualBoundaries) }
  let slices: RawSlice[]
  switch (kind) {
    case "markdown": slices = parseMarkdown(text, options.strategy, options.headingDepth); break
    case "csv": slices = parseCsv(text, source.relativePath); break
    case "json": slices = parseJson(text, source.relativePath); break
    case "xml": slices = parseXml(text, source.relativePath); break
    case "diff": slices = parseDiff(text, source.relativePath); break
    case "source-directory": slices = parseCode(text, source.relativePath, options.strategy); break
    default: slices = parseText(text, options.strategy)
  }
  if (!slices.length) warnings.push({ code: "STRUCTURE_FALLBACK", message: "No reviewable structure was detected.", sourcePath: source.relativePath, recovery: "Change the slicing strategy or add manual boundaries." })
  return { ...extracted, slices }
}

function parseMarkdown(text: string, strategy: SliceStrategy, maximumDepth: number): RawSlice[] {
  if (strategy === "paragraph") return parseParagraphs(text)
  if (strategy === "numbered-section" || strategy === "requirement") return parseText(text, strategy)
  const headings = [...text.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].filter((match) => match[1].length <= maximumDepth)
  if (!headings.length) return parseParagraphs(text)
  const ancestorByDepth = new Map<number, string>()
  return headings.map((heading, index) => {
    const level = heading[1].length; const title = heading[2].trim(); const key = `heading:${level}:${slug(title)}`
    const parentKey = [...ancestorByDepth.entries()].filter(([depth]) => depth < level).sort((a, b) => b[0] - a[0])[0]?.[1]
    ancestorByDepth.set(level, key); for (const depth of [...ancestorByDepth.keys()]) if (depth > level) ancestorByDepth.delete(depth)
    return span(text, heading.index ?? 0, headings[index + 1]?.index ?? text.length, title, `heading:${level}:${title}`, key, parentKey)
  })
}

function parseManual(text: string, boundaries: readonly number[]): RawSlice[] {
  const points = [...new Set([0, ...boundaries.filter((point) => point > 0 && point < text.length), text.length])].sort((a, b) => a - b)
  return points.slice(0, -1).map((start, index) => span(text, start, points[index + 1], `Manual slice ${index + 1}`, `offset:${start}`, `manual:${start}`)).filter((slice) => slice.content.length > 0)
}

function parseText(text: string, strategy: SliceStrategy): RawSlice[] {
  if (strategy === "paragraph" || strategy === "auto") return parseParagraphs(text)
  const expression = strategy === "requirement" ? /^(?:REQ[-_ ]?[A-Z0-9.-]+|[A-Z]{2,}-\d+)(?:\s*[:\-]\s*|\s+)(.+)$/gmi : /^(\d+(?:\.\d+)*)(?:\s+)(.+)$/gm
  const sections = [...text.matchAll(expression)]
  if (!sections.length) return [span(text, 0, text.length, "Source text", "text:1", "text:1")]
  return sections.map((section, index) => {
    const identity = section[0].trim().split(/\s|:/)[0]
    const title = (section[2] ?? section[1] ?? identity).trim()
    return span(text, section.index ?? 0, sections[index + 1]?.index ?? text.length, title, `section:${identity}`, `section:${identity.toLowerCase()}`)
  })
}

function parseParagraphs(text: string): RawSlice[] {
  return [...text.matchAll(/\S[\s\S]*?(?=\n[ \t]*\n|$)/g)].map((match, index) => span(text, match.index ?? 0, (match.index ?? 0) + match[0].length, `Paragraph ${index + 1}`, `paragraph:${index + 1}`, `paragraph:${index + 1}`))
}

function parseCsv(text: string, path: string): RawSlice[] {
  const rows = readCsv(text, path)
  if (rows.length < 2) return []
  const headers = rows[0].values
  const identities = new Map<string, number>()
  return rows.slice(1).filter((row) => row.values.some((value) => value.length > 0)).map((row, index) => {
    const natural = headers[0] && row.values[0] ? `${slug(headers[0])}:${slug(row.values[0])}` : `row:${index + 2}`
    const occurrence = (identities.get(natural) ?? 0) + 1; identities.set(natural, occurrence)
    const key = occurrence === 1 ? `csv:${natural}` : `csv:${natural}:${occurrence}`
    return span(text, row.start, row.end, `Row ${index + 1}`, `row:${index + 2}`, key)
  })
}

function readCsv(text: string, path: string): { values: string[]; start: number; end: number }[] {
  const rows: { values: string[]; start: number; end: number }[] = []; let values: string[] = []; let value = ""; let quoted = false; let rowStart = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]; const next = text[index + 1]
    if (character === '"' && quoted && next === '"') { value += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === "," && !quoted) { values.push(value); value = "" }
    else if (character === "\n" && !quoted) { values.push(value); rows.push({ values, start: rowStart, end: index }); values = []; value = ""; rowStart = index + 1 }
    else value += character
  }
  if (quoted) throw new ArtifactImportError("INVALID_CSV", "The CSV has an unclosed quoted field.", path, "Close the quoted field and import the file again.")
  if (value.length || values.length) { values.push(value); rows.push({ values, start: rowStart, end: text.length }) }
  return rows
}

function parseJson(text: string, path: string): RawSlice[] {
  try { JSON.parse(text) } catch (cause) { throw new ArtifactImportError("INVALID_JSON", "The JSON source is invalid.", path, "Correct the JSON syntax and import the file again.", { cause }) }
  const start = skipWhitespace(text, 0)
  if (text[start] === "{") return scanJsonObject(text, start)
  if (text[start] === "[") return scanJsonArray(text, start)
  return [span(text, start, scanJsonValue(text, start), "value", "json:/", "json:/")]
}

function scanJsonObject(text: string, rootStart: number): RawSlice[] {
  const slices: RawSlice[] = []; let cursor = skipWhitespace(text, rootStart + 1)
  while (cursor < text.length && text[cursor] !== "}") {
    if (text[cursor] !== '"') break
    const keyEnd = scanJsonString(text, cursor); const key = JSON.parse(text.slice(cursor, keyEnd)) as string
    cursor = skipWhitespace(text, keyEnd); if (text[cursor] !== ":") break
    const valueStart = skipWhitespace(text, cursor + 1); const valueEnd = scanJsonValue(text, valueStart); const pointer = key.replaceAll("~", "~0").replaceAll("/", "~1")
    slices.push(span(text, valueStart, valueEnd, key, `json:/${pointer}`, `json:/${pointer}`))
    cursor = skipWhitespace(text, valueEnd); if (text[cursor] === ",") cursor = skipWhitespace(text, cursor + 1); else break
  }
  return slices
}

function scanJsonArray(text: string, rootStart: number): RawSlice[] {
  const slices: RawSlice[] = []; let cursor = skipWhitespace(text, rootStart + 1); let index = 0
  while (cursor < text.length && text[cursor] !== "]") {
    const end = scanJsonValue(text, cursor); slices.push(span(text, cursor, end, `Item ${index + 1}`, `json:/${index}`, `json:/${index}`)); index += 1
    cursor = skipWhitespace(text, end); if (text[cursor] === ",") cursor = skipWhitespace(text, cursor + 1); else break
  }
  return slices
}

function scanJsonValue(text: string, start: number): number {
  if (text[start] === '"') return scanJsonString(text, start)
  if (text[start] === "{" || text[start] === "[") {
    const open = text[start]; const close = open === "{" ? "}" : "]"; let depth = 0; let inString = false; let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (inString) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') inString = false; continue }
      if (character === '"') inString = true
      else if (character === open) depth += 1
      else if (character === close && --depth === 0) return index + 1
    }
    return text.length
  }
  let end = start; while (end < text.length && !/[\s,}\]]/.test(text[end])) end += 1
  return end
}
function scanJsonString(text: string, start: number): number { let escaped = false; for (let index = start + 1; index < text.length; index += 1) { const character = text[index]; if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') return index + 1 } return text.length }
function skipWhitespace(text: string, start: number): number { let cursor = start; while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1; return cursor }

function parseXml(text: string, path: string): RawSlice[] {
  const tokens = [...text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\/?>/g)]
  const stack: { name: string; start: number }[] = []; const children: { name: string; start: number; end: number }[] = []; let root: string | undefined
  for (const token of tokens) {
    const raw = token[0]; const name = token[1]; if (!name || raw.startsWith("<?") || raw.startsWith("<!--") || raw.startsWith("<![")) continue
    if (raw.startsWith("</")) {
      const opened = stack.pop(); if (!opened || opened.name !== name) throw new ArtifactImportError("INVALID_XML", "The XML elements are not balanced.", path, "Correct the XML element nesting and import the file again.")
      if (stack.length === 1) children.push({ name, start: opened.start, end: (token.index ?? 0) + raw.length })
    } else if (raw.endsWith("/>")) {
      if (stack.length === 1) children.push({ name, start: token.index ?? 0, end: (token.index ?? 0) + raw.length })
      if (!root) root = name
    } else { if (!root) root = name; stack.push({ name, start: token.index ?? 0 }) }
  }
  if (!root || stack.length) throw new ArtifactImportError("INVALID_XML", "The XML source has no complete root element.", path, "Correct the XML root element and import the file again.")
  const occurrences = new Map<string, number>()
  if (!children.length) return [span(text, 0, text.length, root, `xml:/${root}`, `xml:/${root}`)]
  return children.map((child) => { const number = (occurrences.get(child.name) ?? 0) + 1; occurrences.set(child.name, number); return span(text, child.start, child.end, `${child.name} ${number}`, `xml:/${root}/${child.name}[${number}]`, `xml:/${root}/${child.name}[${number}]`) })
}

function parseDiff(text: string, path: string): RawSlice[] {
  const files = [...text.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)]
  if (!files.length) throw new ArtifactImportError("INVALID_DIFF", "The diff source has no Git file header.", path, "Select a Git patch or unified diff with file headers.")
  return files.flatMap((file, fileIndex) => {
    const fileStart = file.index ?? 0; const fileEnd = files[fileIndex + 1]?.index ?? text.length; const block = text.slice(fileStart, fileEnd)
    const hunks = [...block.matchAll(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@.*$/gm)]
    if (!hunks.length) return [span(text, fileStart, fileEnd, file[2], `diff:${file[2]}`, `diff:${file[2]}`)]
    return hunks.map((hunk, index) => { const start = fileStart + (hunk.index ?? 0); const end = fileStart + (hunks[index + 1]?.index ?? block.length); return span(text, start, end, `${file[2]} hunk ${index + 1}`, `diff:${file[2]}:new-line-${hunk[2]}`, `diff:${file[2]}:${hunk[2]}`) })
  })
}

function parseCode(text: string, path: string, strategy: SliceStrategy): RawSlice[] {
  if (strategy === "file") return [span(text, 0, text.length, path, "file:1", `file:${path}`)]
  if (strategy === "paragraph") return parseParagraphs(text)
  const declarations = [...text.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+)*(?:function|class|interface|type|enum|def|fn|const|let|var)\s+([\w$]+)/gm)]
  if (!declarations.length) return [span(text, 0, text.length, path, "file:1", `file:${path}`)]
  return declarations.map((declaration, index) => span(text, declaration.index ?? 0, declarations[index + 1]?.index ?? text.length, declaration[1], `symbol:${declaration[1]}`, `symbol:${declaration[1]}`))
}

function extractDocx(source: ArtifactSource): string {
  let xml: Uint8Array
  try { xml = readZipEntry(source.bytes, "word/document.xml") } catch (cause) { throw new ArtifactImportError("INVALID_DOCX", "The DOCX package has no readable document XML.", source.relativePath, "Select a valid DOCX file and import it again.", { cause }) }
  const documentXml = decoder.decode(xml)
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((paragraph) => paragraph[0].replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "").trim())
  const text = decodeEntities(paragraphs.filter(Boolean).join("\n\n"))
  if (!text) throw new ArtifactImportError("INVALID_DOCX", "The DOCX file has no readable text.", source.relativePath, "Select a DOCX file that contains document text.")
  return text
}

function readZipEntry(bytes: Uint8Array, requestedName: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const end = findSignature(bytes, 0x06054b50)
  if (end < 0) throw new Error("ZIP end record missing")
  const directoryOffset = view.getUint32(end + 16, true); const entries = view.getUint16(end + 10, true); let cursor = directoryOffset
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP directory invalid")
    const method = view.getUint16(cursor + 10, true); const compressedSize = view.getUint32(cursor + 20, true); const nameLength = view.getUint16(cursor + 28, true); const extraLength = view.getUint16(cursor + 30, true); const commentLength = view.getUint16(cursor + 32, true); const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (name === requestedName) { const localNameLength = view.getUint16(localOffset + 26, true); const localExtraLength = view.getUint16(localOffset + 28, true); const dataStart = localOffset + 30 + localNameLength + localExtraLength; const compressed = bytes.subarray(dataStart, dataStart + compressedSize); if (method === 0) return compressed; if (method === 8) return inflateRawSync(compressed); throw new Error("ZIP compression unsupported") }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error("ZIP entry missing")
}
function findSignature(bytes: Uint8Array, signature: number): number { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let index = Math.max(0, bytes.length - 65_557); index <= bytes.length - 4; index += 1) if (view.getUint32(index, true) === signature) return index; return -1 }

function extractPdf(source: ArtifactSource, warnings: ImportWarning[]): string {
  const raw = new TextDecoder("latin1").decode(source.bytes)
  if (!raw.startsWith("%PDF-")) throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF header is invalid.", source.relativePath, "Select a text-based PDF and import it again.")
  const streams: string[] = []
  for (const match of raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let content = match[2]; if (/\/FlateDecode/.test(match[1])) { try { content = new TextDecoder("latin1").decode(inflateSync(Buffer.from(content, "latin1"))) } catch { continue } } streams.push(extractPdfStrings(content)) }
  const text = streams.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  if (!text) throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF has no supported embedded text.", source.relativePath, "Use a text-based PDF with selectable text. Scanned PDFs require OCR and are not supported.")
  warnings.push({ code: "PDF_TEXT_LIMITED", message: "The PDF importer extracted embedded text operators; visual layout is not reproduced.", sourcePath: source.relativePath, recovery: "Check the slice preview against the source before confirmation." })
  return text
}
function extractPdfStrings(stream: string): string { const pieces: string[] = []; for (const block of stream.matchAll(/BT([\s\S]*?)ET/g)) for (const token of block[1].matchAll(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g)) pieces.push(decodePdfToken(token[0])); return pieces.filter(Boolean).join(" ") }
function decodePdfToken(token: string): string { if (token.startsWith("<")) return Buffer.from(token.slice(1, -1).replace(/\s/g, ""), "hex").toString("latin1"); return token.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_all, character: string) => hasKey(pdfEscapes, character) ? pdfEscapes[character] : character).replace(/\\([0-7]{1,3})/g, (_all, octal) => String.fromCharCode(Number.parseInt(octal, 8))) }
function decodeEntities(value: string): string { return value.replace(/&(amp|lt|gt|quot|apos);/g, (_all, entity: string) => hasKey(namedEntities, entity) ? namedEntities[entity] : entity) }
function hasKey<Value extends object>(value: Value, key: PropertyKey): key is keyof Value { return Object.prototype.hasOwnProperty.call(value, key) }
function span(text: string, start: number, end: number, title: string, locator: string, key: string, parentKey?: string): RawSlice { return { title, ...trimSpan(text, start, end), locator, key, parentKey } }
