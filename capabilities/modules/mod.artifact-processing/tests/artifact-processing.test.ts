import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { deflateSync } from "node:zlib"
import { ArtifactImportError, compareRevisions, createArtifactProcessing, createManualMappingSet, importArtifact, importLocalPath, parseManualMappingSet } from "../src/index.ts"

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

test("the public factory is headless and exposes the approved operations", () => {
  const module = createArtifactProcessing()
  assert.equal(module.moduleId, "mod.artifact-processing")
  assert.equal(typeof module.importArtifact, "function")
  assert.equal(typeof module.compareRevisions, "function")
  assert.equal("mount" in module, false)
})

test("creates deterministic, unique, exact Markdown slices without changing source bytes", async () => {
  const source = bytes("intro\n\n# Same\nAlpha\n\n# Same\nBeta")
  const original = [...source]
  const input = { displayName: "guide.md", importedAt: "2026-08-01T00:00:00.000Z", source: { displayName: "guide.md", relativePath: "guide.md", bytes: source } }
  const first = await importArtifact(input); const second = await importArtifact(input)
  assert.deepEqual([...source], original)
  assert.equal(first.slices.length, 2)
  assert.equal(new Set(first.slices.map((slice) => slice.id)).size, 2)
  assert.deepEqual(first.slices, second.slices)
  assert.equal(first.slices[1].source.startLine, 6)
  assert.equal(first.slices[1].content, sourceText(source).slice(first.slices[1].source.startOffset, first.slices[1].source.endOffset))
})

test("previews exclusions, manual boundaries, combine, and split settings", async () => {
  const manual = await importArtifact({ displayName: "guide.txt", source: { displayName: "guide.txt", relativePath: "guide.txt", bytes: bytes("Alpha\nBeta\nGamma") } }, { strategy: "manual", manualBoundaries: [6, 11], excludedTitles: ["Manual slice 2"] })
  assert.deepEqual(manual.slices.map((slice) => slice.content), ["Alpha", "Gamma"])
  assert.equal(manual.preview.excludedSectionCount, 1)
  const configured = await importArtifact({ displayName: "guide.txt", source: { displayName: "guide.txt", relativePath: "guide.txt", bytes: bytes("A\n\nshort\n\nThis paragraph is deliberately longer than the configured limit.") } }, { strategy: "paragraph", combineBelowCharacters: 8, splitAboveCharacters: 24 })
  assert.ok(configured.warnings.some((warning) => warning.code === "SLICE_COMBINED"))
  assert.ok(configured.warnings.some((warning) => warning.code === "SLICE_SPLIT"))
})

test("slices CSV, JSON, XML, Git diff, DOCX, text PDF, and a source directory", async () => {
  const fixtures = [
    ["data.csv", "name,value\nAlpha,1\nBeta,2", 2],
    ["data.json", '{"alpha":{"value":1},"beta":{"value":2}}', 2],
    ["data.xml", "<root><item>Alpha</item><item>Beta</item></root>", 2],
    ["change.diff", "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n", 1],
  ] as const
  for (const [relativePath, content, expected] of fixtures) {
    const result = await importArtifact({ displayName: relativePath, source: { displayName: relativePath, relativePath, bytes: bytes(content) } })
    assert.equal(result.slices.length, expected)
    for (const slice of result.slices) assert.ok(slice.source.endOffset > slice.source.startOffset)
  }
  const docx = structuredDocx()
  const pdf = textPdf("BT /F1 12 Tf 72 720 Td [(Alpha) -250 (PDF)] TJ ET", true)
  const docxResult = await importArtifact({ displayName: "guide.docx", source: { displayName: "guide.docx", relativePath: "guide.docx", bytes: docx } })
  assert.equal(docxResult.slices[0].title, "System requirements")
  assert.match(docxResult.slices[0].content, /^- First control item/m)
  assert.match(docxResult.slices[0].content, /Parameter\s+Limit/)
  assert.ok(docxResult.warnings.some((warning) => warning.code === "DOCX_TEXT_LIMITED"))
  const pdfResult = await importArtifact({ displayName: "guide.pdf", source: { displayName: "guide.pdf", relativePath: "guide.pdf", bytes: pdf } })
  assert.match(pdfResult.slices[0].content, /Alpha PDF/); assert.equal(pdfResult.slices[0].source.coordinateSystem, "extracted-pdf-text")
  const folder = await mkdtemp(join(tmpdir(), "artifact-processing-"))
  try { await writeFile(join(folder, "alpha.ts"), "export function alpha() { return 1 }\nexport function beta() { return 2 }"); assert.equal((await importLocalPath(folder)).slices.length, 2) }
  finally { await rm(folder, { recursive: true, force: true }) }
})

test("reports actionable diagnostics for malformed Word and image-only PDF inputs", async () => {
  await assert.rejects(() => importArtifact({ displayName: "bad.json", source: { displayName: "bad.json", relativePath: "bad.json", bytes: bytes("{") } }), (error: unknown) => error instanceof ArtifactImportError && error.code === "INVALID_JSON" && Boolean(error.recovery))
  const wordResult = await createArtifactProcessing().importArtifact({ displayName: "bad.docx", source: { displayName: "bad.docx", relativePath: "bad.docx", bytes: bytes("not a Word package") } })
  assert.equal(wordResult.ok, false)
  if (!wordResult.ok) {
    assert.equal(wordResult.error.code, "INVALID_DOCX")
    assert.match(wordResult.error.recovery, /re-save/)
  }
  const result = await createArtifactProcessing().importArtifact({ displayName: "scan.pdf", source: { displayName: "scan.pdf", relativePath: "scan.pdf", bytes: textPdf("") } })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, "PDF_TEXT_UNAVAILABLE")
    assert.match(result.error.message, /image-only or scanned/)
    assert.match(result.error.recovery, /Run OCR/)
  }
})

test("classifies unchanged, modified, added, removed, relocated, and unmatched slices", async () => {
  const before = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: bytes("# Alpha\nSame\n\n# Beta\nOld\n\n# Remove\nGone\n\n# Uncertain Alpha\nred green blue") } })
  before.slices[0].reviewState = "accepted"; before.slices[0].findingIds = ["FND-1"]
  const after = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: bytes("# Added\nFresh\n\n# Alpha\nSame\n\n# Beta\nNew\n\n# Uncertain Beta\nred green yellow") } })
  const comparison = await compareRevisions(before.slices, after.slices, { fuzzyThreshold: 0.95, uncertainThreshold: 0.2 })
  assert.equal(comparison.counts.relocated, 1)
  assert.equal(comparison.counts.modified, 1)
  assert.equal(comparison.counts.added, 1)
  assert.equal(comparison.counts.removed, 1)
  assert.equal(comparison.counts.unmatched, 1)
  const stable = comparison.current.find((slice) => slice.title === "Alpha")!
  assert.equal(stable.reviewState, "accepted"); assert.deepEqual(stable.findingIds, ["FND-1"])
})

test("manual mapping sets are durable, hash-bound, and user-confirmed", async () => {
  const previous = (await importArtifact({ displayName: "a.md", source: { displayName: "a.md", relativePath: "a.md", bytes: bytes("# Alpha\nFixed") } })).slices
  const current = (await importArtifact({ displayName: "b.md", source: { displayName: "b.md", relativePath: "b.md", bytes: bytes("# Renamed\nChanged") } })).slices
  const mapping = { previousSliceId: previous[0].id, currentSliceId: current[0].id, correctedAt: "2026-08-01T00:00:00.000Z", userConfirmed: true }
  const set = createManualMappingSet(previous, current, [mapping], "2026-08-01T00:00:00.000Z")
  assert.deepEqual(parseManualMappingSet(JSON.stringify(set)), set)
  const result = await compareRevisions(previous, current, { manualMappingSet: set })
  assert.equal(result.mappings[0].reason, "reviewer"); assert.equal(result.mappings[0].userConfirmed, true)
  await assert.rejects(() => compareRevisions(previous, [...current, { ...current[0], id: "extra" }], { manualMappingSet: set }), ArtifactImportError)
})

test("compares 5000 deterministic slices inside the responsiveness target", async () => {
  const create = (prefix: string) => Array.from({ length: 5_000 }, (_, sequence) => ({ id: `${prefix}-${sequence}`, matchKey: `key-${sequence}`, artifactId: prefix, sourceHash: "source", contentHash: `content-${sequence}`, title: `Section ${sequence}`, content: `Stable content ${sequence}`, parentId: null, sequence, source: { path: "source.md", startOffset: sequence, endOffset: sequence + 1, startLine: sequence + 1, endLine: sequence + 1, coordinateSystem: "decoded-text" as const }, preview: { excerpt: "Stable", characterCount: 6, lineCount: 1 }, reviewState: "accepted" as const, revisionState: "added" as const, findingIds: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }))
  const started = performance.now(); const result = await compareRevisions(create("before"), create("after")); const elapsed = performance.now() - started
  assert.equal(result.counts.unchanged, 5_000); assert.ok(elapsed < 5_000, `Comparison took ${elapsed}ms.`)
})

function sourceText(value: Uint8Array): string { return new TextDecoder().decode(value) }
function textPdf(content: string, compressed = false): Uint8Array {
  const header = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")
  const stream = Buffer.from(content, "latin1")
  const body = compressed ? deflateSync(stream) : stream
  const filter = compressed ? " /Filter /FlateDecode" : ""
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", "latin1"),
    Buffer.concat([Buffer.from(`<< /Length ${body.length}${filter} >>\nstream\n`, "latin1"), body, Buffer.from("\nendstream", "latin1")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
  ]
  const records: Buffer[] = []
  const offsets: number[] = [0]
  let offset = header.length
  objects.forEach((object, index) => {
    const record = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), object, Buffer.from("\nendobj\n", "latin1")])
    offsets.push(offset)
    records.push(record)
    offset += record.length
  })
  const xrefOffset = offset
  const xref = Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `).join("\n")}\n`, "latin1")
  const trailer = Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "latin1")
  return Buffer.concat([header, ...records, xref, trailer])
}
function structuredDocx(): Uint8Array {
  return zipStored({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>System requirements</w:t></w:r></w:p><w:p><w:r><w:t>Introductory review text.</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First control item</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Parameter</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Limit</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100 Hz</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>`,
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  })
}
function zipStored(entries: Readonly<Record<string, string>>): Uint8Array {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0
  for (const [name, content] of Object.entries(entries)) {
    const fileName = Buffer.from(name)
    const body = Buffer.from(content)
    const local = Buffer.alloc(30 + fileName.length + body.length)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(fileName.length, 26); fileName.copy(local, 30); body.copy(local, 30 + fileName.length)
    const central = Buffer.alloc(46 + fileName.length)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(localOffset, 42); fileName.copy(central, 46)
    localRecords.push(local); centralRecords.push(central); localOffset += local.length
  }
  const centralDirectory = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(localRecords.length, 8); end.writeUInt16LE(localRecords.length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localRecords, centralDirectory, end])
}
