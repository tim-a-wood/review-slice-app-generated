import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ArtifactImportError, compareRevisions, importArtifact, importLocalPath } from "../src/index.ts"

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

test("create deterministic Markdown slices without source changes", async () => {
  const source = bytes("# Alpha\nText A.\n\n# Beta\nText B.")
  const initial = [...source]
  const first = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: source } })
  const second = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: source } })
  assert.deepEqual([...source], initial)
  assert.equal(first.slices.length, 2)
  assert.deepEqual(first.slices.map((slice) => [slice.id, slice.matchKey, slice.contentHash]), second.slices.map((slice) => [slice.id, slice.matchKey, slice.contentHash]))
})

test("slice structured and change artifacts", async () => {
  const fixtures = [
    ["data.csv", "name,value\nAlpha,1\nBeta,2", 2],
    ["data.json", '{"alpha":{"value":1},"beta":{"value":2}}', 2],
    ["data.xml", "<root><item>Alpha</item><item>Beta</item></root>", 2],
    ["change.diff", "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n", 1],
  ] as const
  for (const [relativePath, content, expected] of fixtures) {
    const result = await importArtifact({ displayName: relativePath, source: { displayName: relativePath, relativePath, bytes: bytes(content) } })
    assert.equal(result.slices.length, expected)
  }
})

test("read DOCX and text PDF sources", async () => {
  const docx = zipStored("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>Alpha text</w:t></w:r></w:p><w:p><w:r><w:t>Beta text</w:t></w:r></w:p></w:body></w:document>')
  const pdf = bytes("%PDF-1.4\n<< >>\nstream\nBT (Alpha PDF) Tj ET\nendstream\n%%EOF")
  const docxResult = await importArtifact({ displayName: "guide.docx", source: { displayName: "guide.docx", relativePath: "guide.docx", bytes: docx } })
  const pdfResult = await importArtifact({ displayName: "guide.pdf", source: { displayName: "guide.pdf", relativePath: "guide.pdf", bytes: pdf } })
  assert.match(docxResult.slices[0].content, /Alpha text/)
  assert.match(pdfResult.slices[0].content, /Alpha PDF/)
})

test("read source directories without source edits", async () => {
  const folder = await mkdtemp(join(tmpdir(), "artifact-processing-"))
  try {
    await writeFile(join(folder, "alpha.ts"), "export function alpha() { return 1 }\nexport function beta() { return 2 }")
    const result = await importLocalPath(folder)
    assert.equal(result.artifact.kind, "source-directory")
    assert.equal(result.slices.length, 2)
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test("classify revisions and preserve stable decisions", async () => {
  const before = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: bytes("# Alpha\nSame\n\n# Beta\nOld") } })
  before.slices[0].reviewState = "accepted"
  const after = await importArtifact({ displayName: "guide.md", source: { displayName: "guide.md", relativePath: "guide.md", bytes: bytes("# Alpha\nSame\n\n# Beta\nNew\n\n# Gamma\nAdd") } })
  const comparison = await compareRevisions(before.slices, after.slices)
  assert.equal(comparison.counts.unchanged, 1)
  assert.equal(comparison.counts.modified, 1)
  assert.equal(comparison.counts.added, 1)
  assert.equal(comparison.current.find((slice) => slice.title === "Alpha")?.reviewState, "accepted")
  assert.equal(comparison.current.find((slice) => slice.title === "Beta")?.reviewState, "re-review-required")
})

test("apply reviewer mapping and report invalid sources", async () => {
  const previous = await importArtifact({ displayName: "a.md", source: { displayName: "a.md", relativePath: "a.md", bytes: bytes("# Alpha\nFixed content") } })
  const current = await importArtifact({ displayName: "b.md", source: { displayName: "b.md", relativePath: "b.md", bytes: bytes("# Renamed\nFixed content") } })
  const comparison = await compareRevisions(previous.slices, current.slices, { reviewerMappings: [{ previousSliceId: previous.slices[0].id, currentSliceId: current.slices[0].id, correctedAt: "2026-08-01T00:00:00.000Z" }] })
  assert.equal(comparison.mappings[0].reason, "reviewer")
  await assert.rejects(() => importArtifact({ displayName: "bad.json", source: { displayName: "bad.json", relativePath: "bad.json", bytes: bytes("{") } }), ArtifactImportError)
})

test("compare 5000 slices within the responsiveness target", async () => {
  const create = (prefix: string) => Array.from({ length: 5_000 }, (_, sequence) => ({ id: `${prefix}-${sequence}`, matchKey: `key-${sequence}`, artifactId: prefix, sourceHash: "source", contentHash: `content-${sequence}`, title: `Section ${sequence}`, content: `Stable content ${sequence}`, parentId: null, sequence, source: { path: "source.md", startOffset: sequence, endOffset: sequence + 1, startLine: sequence + 1, endLine: sequence + 1 }, preview: { excerpt: "Stable", characterCount: 6, lineCount: 1 }, reviewState: "accepted" as const, revisionState: "added" as const, findingIds: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }))
  const started = performance.now(); const result = await compareRevisions(create("before"), create("after")); const elapsed = performance.now() - started
  assert.equal(result.counts.unchanged, 5_000)
  assert.ok(elapsed < 5_000, `Comparison took ${elapsed}ms.`)
})

function zipStored(name: string, content: string): Uint8Array {
  const fileName = Buffer.from(name); const body = Buffer.from(content); const local = Buffer.alloc(30 + fileName.length + body.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(fileName.length, 26); fileName.copy(local, 30); body.copy(local, 30 + fileName.length)
  const central = Buffer.alloc(46 + fileName.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(fileName.length, 28); fileName.copy(central, 46)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}
