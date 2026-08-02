import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
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
  const docx = zipStored("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>Alpha text</w:t></w:r></w:p><w:p><w:r><w:t>Beta text</w:t></w:r></w:p></w:body></w:document>')
  const pdf = bytes("%PDF-1.4\n<< >>\nstream\nBT (Alpha PDF) Tj ET\nendstream\n%%EOF")
  assert.match((await importArtifact({ displayName: "guide.docx", source: { displayName: "guide.docx", relativePath: "guide.docx", bytes: docx } })).slices[0].content, /Alpha text/)
  const pdfResult = await importArtifact({ displayName: "guide.pdf", source: { displayName: "guide.pdf", relativePath: "guide.pdf", bytes: pdf } })
  assert.match(pdfResult.slices[0].content, /Alpha PDF/); assert.equal(pdfResult.slices[0].source.coordinateSystem, "extracted-pdf-text")
  const folder = await mkdtemp(join(tmpdir(), "artifact-processing-"))
  try { await writeFile(join(folder, "alpha.ts"), "export function alpha() { return 1 }\nexport function beta() { return 2 }"); assert.equal((await importLocalPath(folder)).slices.length, 2) }
  finally { await rm(folder, { recursive: true, force: true }) }
})

test("reports recoverable diagnostics for malformed and scanned inputs", async () => {
  await assert.rejects(() => importArtifact({ displayName: "bad.json", source: { displayName: "bad.json", relativePath: "bad.json", bytes: bytes("{") } }), (error: unknown) => error instanceof ArtifactImportError && error.code === "INVALID_JSON" && Boolean(error.recovery))
  const result = await createArtifactProcessing().importArtifact({ displayName: "scan.pdf", source: { displayName: "scan.pdf", relativePath: "scan.pdf", bytes: bytes("%PDF-1.4\n%%EOF") } })
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "PDF_TEXT_UNAVAILABLE")
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
function zipStored(name: string, content: string): Uint8Array {
  const fileName = Buffer.from(name); const body = Buffer.from(content); const local = Buffer.alloc(30 + fileName.length + body.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(fileName.length, 26); fileName.copy(local, 30); body.copy(local, 30 + fileName.length)
  const central = Buffer.alloc(46 + fileName.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(fileName.length, 28); fileName.copy(central, 46)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}
