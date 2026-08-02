import { ArtifactImportError } from "./contracts.ts"
import type { ArtifactSlice, CompareOptions, ManualMappingSet, RevisionCandidate, RevisionComparison, RevisionMapping, RevisionState, ReviewerMapping } from "./contracts.ts"
import { sha256 } from "./hash.ts"

const states: RevisionState[] = ["unchanged", "modified", "added", "removed", "relocated", "unmatched"]

export function sliceSetHash(slices: readonly ArtifactSlice[]): string {
  return sha256(JSON.stringify([...slices].sort((a, b) => a.id.localeCompare(b.id)).map((slice) => [slice.id, slice.matchKey, slice.sourceHash, slice.contentHash, slice.source.path, slice.source.locator ?? ""])))
}

export function createManualMappingSet(previous: readonly ArtifactSlice[], current: readonly ArtifactSlice[], mappings: readonly ReviewerMapping[], recordedAt: string): ManualMappingSet {
  validateReviewerMappings(previous, current, mappings)
  const body = {
    schemaVersion: "1.0" as const, previousSliceSetHash: sliceSetHash(previous), currentSliceSetHash: sliceSetHash(current),
    mappings: [...mappings].map((mapping) => ({ ...mapping, userConfirmed: true })).sort((a, b) => a.previousSliceId.localeCompare(b.previousSliceId) || a.currentSliceId.localeCompare(b.currentSliceId)), recordedAt,
  }
  return { ...body, contentHash: sha256(JSON.stringify(body)) }
}

export function parseManualMappingSet(json: string): ManualMappingSet {
  let candidate: unknown
  try { candidate = JSON.parse(json) } catch (cause) { throw mappingError("The manual mapping JSON is invalid.", cause) }
  if (!candidate || typeof candidate !== "object") throw mappingError("The manual mapping set is missing.")
  const value = candidate as Partial<ManualMappingSet>
  if (value.schemaVersion !== "1.0" || !value.previousSliceSetHash || !value.currentSliceSetHash || !Array.isArray(value.mappings) || !value.recordedAt || !value.contentHash) throw mappingError("The manual mapping set is incomplete.")
  const body = { schemaVersion: value.schemaVersion, previousSliceSetHash: value.previousSliceSetHash, currentSliceSetHash: value.currentSliceSetHash, mappings: value.mappings, recordedAt: value.recordedAt }
  if (sha256(JSON.stringify(body)) !== value.contentHash) throw mappingError("The manual mapping set hash does not match its content.")
  return value as ManualMappingSet
}

export async function compareRevisions(previousInput: readonly ArtifactSlice[], currentInput: readonly ArtifactSlice[], options: CompareOptions = {}): Promise<RevisionComparison> {
  const previous = previousInput.map(cloneSlice); const current = currentInput.map(cloneSlice)
  const explicit = options.manualMappingSet?.mappings ?? options.reviewerMappings ?? []
  if (options.manualMappingSet && (options.manualMappingSet.previousSliceSetHash !== sliceSetHash(previousInput) || options.manualMappingSet.currentSliceSetHash !== sliceSetHash(currentInput))) throw mappingError("The manual mapping set belongs to different artifact revisions.")
  validateReviewerMappings(previous, current, explicit)
  const matchedPrevious = new Set<string>(); const matchedCurrent = new Set<string>(); const mappings: RevisionMapping[] = []; const uncertainCandidates: RevisionCandidate[] = []
  const byId = new Map(previous.map((slice) => [slice.id, slice])); const currentById = new Map(current.map((slice) => [slice.id, slice]))
  const map = (left: ArtifactSlice, right: ArtifactSlice, reason: RevisionCandidate["reason"], confidence: number): void => {
    if (matchedPrevious.has(left.id) || matchedCurrent.has(right.id)) return
    matchedPrevious.add(left.id); matchedCurrent.add(right.id)
    const revisionState = left.contentHash === right.contentHash ? (sameLocation(left, right) ? "unchanged" : "relocated") : "modified"
    right.revisionState = revisionState; right.previousSliceId = left.id; right.previousReviewState = left.reviewState; right.findingIds = [...left.findingIds]
    right.reviewState = revisionState === "unchanged" || revisionState === "relocated" ? left.reviewState : "re-review-required"
    mappings.push({ previousSliceId: left.id, currentSliceId: right.id, confidence, reason, revisionState, preservedReviewState: right.reviewState, userConfirmed: reason === "reviewer" })
  }
  for (const corrected of explicit) map(byId.get(corrected.previousSliceId)!, currentById.get(corrected.currentSliceId)!, "reviewer", 1)
  const byMatchKey = groupBy(previous, (slice) => slice.matchKey)
  for (const right of current) { const left = byMatchKey.get(right.matchKey)?.find((slice) => !matchedPrevious.has(slice.id)); if (left) map(left, right, "match-key", 1) }
  const byHash = groupBy(previous, (slice) => slice.contentHash)
  for (const right of current) { if (matchedCurrent.has(right.id)) continue; const left = byHash.get(right.contentHash)?.find((slice) => !matchedPrevious.has(slice.id)); if (left) map(left, right, "content-hash", 0.99) }
  const candidateLimit = options.candidateLimit ?? 24; const fuzzyThreshold = options.fuzzyThreshold ?? 0.78; const uncertainThreshold = options.uncertainThreshold ?? 0.56; const buckets = indexCandidates(previous, matchedPrevious)
  for (let index = 0; index < current.length; index += 1) {
    const right = current[index]; if (matchedCurrent.has(right.id)) continue
    const ranked = selectCandidates(right, buckets, matchedPrevious, candidateLimit).map((left) => ({ left, score: similarity(left, right) })).sort((a, b) => b.score - a.score || a.left.id.localeCompare(b.left.id))
    const best = ranked[0]
    if (best?.score >= fuzzyThreshold) map(best.left, right, "fuzzy", best.score)
    else if (best?.score >= uncertainThreshold) { right.revisionState = "unmatched"; right.reviewState = "re-review-required"; uncertainCandidates.push({ previousSliceId: best.left.id, currentSliceId: right.id, confidence: best.score, reason: "fuzzy" }) }
    else { right.revisionState = "added"; right.reviewState = "not-reviewed" }
    if (index > 0 && index % (options.yieldEvery ?? 250) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const uncertainPrevious = new Set(uncertainCandidates.map((candidate) => candidate.previousSliceId))
  for (const left of previous) if (!matchedPrevious.has(left.id)) left.revisionState = uncertainPrevious.has(left.id) ? "unmatched" : "removed"
  const counts = Object.fromEntries(states.map((state) => [state, 0])) as Record<RevisionState, number>
  for (const slice of current) counts[slice.revisionState] += 1
  for (const slice of previous) if (slice.revisionState === "removed") counts.removed += 1
  return { mappings, previous, current, uncertainCandidates, counts, appliedManualMappings: explicit.map((mapping) => ({ ...mapping })) }
}

function validateReviewerMappings(previous: readonly ArtifactSlice[], current: readonly ArtifactSlice[], mappings: readonly ReviewerMapping[]): void {
  const priorIds = new Set(previous.map((slice) => slice.id)); const currentIds = new Set(current.map((slice) => slice.id)); const usedPrevious = new Set<string>(); const usedCurrent = new Set<string>()
  for (const mapping of mappings) {
    if (!priorIds.has(mapping.previousSliceId) || !currentIds.has(mapping.currentSliceId)) throw mappingError("A manual mapping refers to a missing slice.")
    if (usedPrevious.has(mapping.previousSliceId) || usedCurrent.has(mapping.currentSliceId)) throw mappingError("A slice can occur in only one manual mapping.")
    if (!mapping.correctedAt) throw mappingError("A manual mapping must include its correction time.")
    usedPrevious.add(mapping.previousSliceId); usedCurrent.add(mapping.currentSliceId)
  }
}
function mappingError(message: string, cause?: unknown): ArtifactImportError { return new ArtifactImportError("INVALID_REVISION_MAPPING", message, "revision-mapping", "Correct or recreate the manual mapping set before comparison.", { cause }) }
function cloneSlice(slice: ArtifactSlice): ArtifactSlice { return { ...slice, source: { ...slice.source }, preview: { ...slice.preview }, findingIds: [...slice.findingIds] } }
function sameLocation(left: ArtifactSlice, right: ArtifactSlice): boolean { return left.source.path === right.source.path && left.source.locator === right.source.locator && left.source.startOffset === right.source.startOffset && left.parentId === right.parentId }
function groupBy(items: readonly ArtifactSlice[], key: (item: ArtifactSlice) => string): Map<string, ArtifactSlice[]> { const groups = new Map<string, ArtifactSlice[]>(); for (const item of items) { const group = groups.get(key(item)) ?? []; group.push(item); groups.set(key(item), group) } return groups }
function indexCandidates(items: readonly ArtifactSlice[], used: ReadonlySet<string>): Map<string, ArtifactSlice[]> { const index = new Map<string, ArtifactSlice[]>(); for (const item of items) if (!used.has(item.id)) for (const token of tokens(item.title)) { const group = index.get(token) ?? []; group.push(item); index.set(token, group) } return index }
function selectCandidates(slice: ArtifactSlice, index: Map<string, ArtifactSlice[]>, used: ReadonlySet<string>, limit: number): ArtifactSlice[] { const result = new Map<string, ArtifactSlice>(); for (const token of tokens(slice.title)) for (const candidate of index.get(token) ?? []) { if (!used.has(candidate.id)) result.set(candidate.id, candidate); if (result.size >= limit) return [...result.values()] } return [...result.values()] }
function tokens(value: string): string[] { return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2).slice(0, 600))] }
function similarity(left: ArtifactSlice, right: ArtifactSlice): number { return Number((jaccard(tokens(left.title), tokens(right.title)) * 0.45 + jaccard(tokens(left.content), tokens(right.content)) * 0.55).toFixed(4)) }
function jaccard(left: string[], right: string[]): number { const a = new Set(left); const b = new Set(right); if (!a.size && !b.size) return 1; let common = 0; for (const value of a) if (b.has(value)) common += 1; return common / (a.size + b.size - common) }
