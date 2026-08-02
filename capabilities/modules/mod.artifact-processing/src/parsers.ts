import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import mammoth from "mammoth"
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs"
import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactKind, ArtifactSource, CoordinateSystem, ImportWarning, NormalizedSlicingOptions, SliceStrategy } from "./contracts.ts"
import { decodeText, slug, trimSpan, type RawSlice } from "./text.ts"

const textKinds: Record<string, ArtifactKind> = { md: "markdown", markdown: "markdown", txt: "text", text: "text", docx: "docx", pdf: "pdf", csv: "csv", json: "json", xml: "xml", diff: "diff", patch: "diff" }
const codeExtensions = new Set(["c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "kt", "m", "mm", "php", "py", "rb", "rs", "scss", "swift", "ts", "tsx", "vue", "yaml", "yml"])
const namedEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as const
const pdfJsDirectory = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))
const pdfJsAssetDirectory = (name: string): string => toPdfJsAssetDirectory(join(pdfJsDirectory, name))

export function toPdfJsAssetDirectory(path: string): string {
  return `${path.replace(/\\/g, "/").replace(/\/+$/, "")}/`
}

export interface ParsedSource { text: string; slices: RawSlice[]; coordinateSystem: CoordinateSystem }

export function detectKind(source: ArtifactSource): ArtifactKind {
  if (source.kind) return source.kind
  const extension = source.relativePath.split(".").at(-1)?.toLowerCase() ?? ""
  if (textKinds[extension]) return textKinds[extension]
  return codeExtensions.has(extension) ? "source-directory" : "text"
}

export async function parseSource(source: ArtifactSource, options: NormalizedSlicingOptions, warnings: ImportWarning[] = []): Promise<ParsedSource> {
  const kind = detectKind(source)
  const extracted = kind === "docx" ? { text: await extractDocx(source, warnings), coordinateSystem: "extracted-docx-text" as const }
    : kind === "pdf" ? { text: await extractPdf(source, warnings), coordinateSystem: "extracted-pdf-text" as const }
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
    case "docx": slices = parseMarkdown(text, options.strategy, options.headingDepth); break
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

async function extractDocx(source: ArtifactSource, warnings: ImportWarning[]): Promise<string> {
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(source.bytes) },
      {
        externalFileAccess: false,
        includeDefaultStyleMap: true,
        includeEmbeddedStyleMap: true,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
        ],
        convertImage: mammoth.images.imgElement(async () => ({ src: "embedded-image" })),
      },
    )
    for (const message of result.messages) {
      warnings.push({ code: "DOCX_TEXT_LIMITED", message: message.message, sourcePath: source.relativePath, recovery: "Check the slice preview against the Word document before confirmation." })
    }
    if (/<img\b/i.test(result.value)) {
      warnings.push({ code: "DOCX_TEXT_LIMITED", message: "Embedded Word images are identified but their pixels are not converted to review text.", sourcePath: source.relativePath, recovery: "Add captions or run OCR before import when an image contains reviewable text." })
    }
    const text = docxHtmlToStructuredText(result.value)
    if (!text) throw new ArtifactImportError("INVALID_DOCX", "The Word document has no extractable text.", source.relativePath, "If the document contains only page images, run OCR and save a searchable DOCX before retrying.")
    warnings.push({ code: "DOCX_TEXT_LIMITED", message: "Word document structure was extracted; visual pagination, floating objects, and tracked-change presentation are not reproduced.", sourcePath: source.relativePath, recovery: "Check the slice preview against the Word document before confirmation." })
    return text
  } catch (cause) {
    if (cause instanceof ArtifactImportError) throw cause
    throw new ArtifactImportError("INVALID_DOCX", "The Word document could not be parsed.", source.relativePath, "Open and re-save the file as a current DOCX document, then import the new copy.", { cause })
  }
}
function docxHtmlToStructuredText(html: string): string {
  const structural = html
    .replace(/<img\b[^>]*>/gi, " [Embedded image] ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_all, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<tr\b[^>]*>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    .replace(/<(?:td|th)\b[^>]*>/gi, "")
    .replace(/<p\b[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return decodeEntities(structural).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

async function extractPdf(source: ArtifactSource, warnings: ImportWarning[]): Promise<string> {
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(source.bytes),
      cMapUrl: pdfJsAssetDirectory("cmaps"),
      cMapPacked: true,
      isEvalSupported: false,
      standardFontDataUrl: pdfJsAssetDirectory("standard_fonts"),
      useSystemFonts: true,
      verbosity: VerbosityLevel.ERRORS,
      wasmUrl: pdfJsAssetDirectory("wasm"),
    })
    const document = await loadingTask.promise
    try {
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent({ includeMarkedContent: false })
        const text = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "").join("").trim()
        if (text) pages.push(text)
        page.cleanup()
      }
      const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
      if (!text) {
        throw new ArtifactImportError(
          "PDF_TEXT_UNAVAILABLE",
          "The PDF appears to be image-only or scanned and has no extractable text layer.",
          source.relativePath,
          "Run OCR to create a searchable PDF, then import the OCR-processed file.",
        )
      }
      warnings.push({
        code: "PDF_TEXT_LIMITED",
        message: "The PDF text layer was extracted; visual layout and reading order may differ from the rendered pages.",
        sourcePath: source.relativePath,
        recovery: "Check the slice preview against the source before confirmation.",
      })
      return text
    } finally {
      await document.destroy()
    }
  } catch (cause) {
    if (cause instanceof ArtifactImportError) throw cause
    const name = typeof cause === "object" && cause && "name" in cause ? String(cause.name) : ""
    if (name === "PasswordException") {
      throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF is password protected.", source.relativePath, "Remove the PDF password in an authorized PDF editor, then import the unlocked copy.", { cause })
    }
    throw new ArtifactImportError("PDF_TEXT_UNAVAILABLE", "The PDF text layer could not be extracted.", source.relativePath, "Open and re-save the PDF with a current PDF editor, or export it as a searchable PDF, then try again.", { cause })
  }
}
function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(?:x([0-9a-f]+)|(\d+));/gi, (_all, entity: string | undefined, hexadecimal: string | undefined, decimal: string | undefined) => {
    if (!entity) return String.fromCodePoint(Number.parseInt(hexadecimal ?? decimal ?? "0", hexadecimal ? 16 : 10))
    const normalized = entity.toLowerCase()
    if (normalized === "nbsp") return " "
    return hasKey(namedEntities, normalized) ? namedEntities[normalized] : entity
  })
}
function hasKey<Value extends object>(value: Value, key: PropertyKey): key is keyof Value { return Object.prototype.hasOwnProperty.call(value, key) }
function span(text: string, start: number, end: number, title: string, locator: string, key: string, parentKey?: string): RawSlice { return { title, ...trimSpan(text, start, end), locator, key, parentKey } }
