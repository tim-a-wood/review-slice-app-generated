import type { ArtifactSlice, CompareOptions, RevisionCandidate, RevisionComparison, RevisionMapping, RevisionState, ReviewerMapping } from "./contracts.ts"

const states: RevisionState[] = ["unchanged", "modified", "added", "removed", "relocated", "unmatched"]

export async function compareRevisions(previousInput: readonly ArtifactSlice[], currentInput: readonly ArtifactSlice[], options: CompareOptions = {}): Promise<RevisionComparison> {
  const previous = previousInput.map(cloneSlice); const current = currentInput.map(cloneSlice)
  const matchedPrevious = new Set<string>(); const matchedCurrent = new Set<string>(); const mappings: RevisionMapping[] = []; const uncertainCandidates: RevisionCandidate[] = []
  const byId = new Map(previous.map((slice) => [slice.id, slice])); const currentById = new Map(current.map((slice) => [slice.id, slice]))
  const map = (left: ArtifactSlice, right: ArtifactSlice, reason: RevisionCandidate["reason"], confidence: number): void => {
    if (matchedPrevious.has(left.id) || matchedCurrent.has(right.id)) return
    matchedPrevious.add(left.id); matchedCurrent.add(right.id)
    const revisionState = left.contentHash === right.contentHash ? (sameLocation(left, right) ? "unchanged" : "relocated") : "modified"
    right.revisionState = revisionState
    if (revisionState === "unchanged" || revisionState === "relocated") right.reviewState = left.reviewState
    else right.reviewState = "re-review-required"
    mappings.push({ previousSliceId: left.id, currentSliceId: right.id, confidence, reason, revisionState, preservedReviewState: right.reviewState })
  }
  for (const corrected of options.reviewerMappings ?? []) { const left = byId.get(corrected.previousSliceId); const right = currentById.get(corrected.currentSliceId); if (left && right) map(left, right, "reviewer", 1) }
  const byMatchKey = groupBy(previous, (slice) => slice.matchKey)
  for (const right of current) { const left = byMatchKey.get(right.matchKey)?.find((slice) => !matchedPrevious.has(slice.id)); if (left) map(left, right, "match-key", 1) }
  const byHash = groupBy(previous, (slice) => slice.contentHash)
  for (const right of current) { if (matchedCurrent.has(right.id)) continue; const left = byHash.get(right.contentHash)?.find((slice) => !matchedPrevious.has(slice.id)); if (left) map(left, right, "content-hash", 0.99) }
  const candidateLimit = options.candidateLimit ?? 24; const fuzzyThreshold = options.fuzzyThreshold ?? 0.78; const uncertainThreshold = options.uncertainThreshold ?? 0.56; const buckets = indexCandidates(previous, matchedPrevious)
  for (let index = 0; index < current.length; index += 1) {
    const right = current[index]
    if (matchedCurrent.has(right.id)) continue
    const candidates = selectCandidates(right, buckets, matchedPrevious, candidateLimit)
    const ranked = candidates.map((left) => ({ left, score: similarity(left, right) })).sort((left, right) => right.score - left.score || left.left.id.localeCompare(right.left.id))
    const best = ranked[0]
    if (best?.score >= fuzzyThreshold) map(best.left, right, "fuzzy", best.score)
    else if (best?.score >= uncertainThreshold) { right.revisionState = "unmatched"; uncertainCandidates.push({ previousSliceId: best.left.id, currentSliceId: right.id, confidence: best.score, reason: "fuzzy" }) }
    else right.revisionState = "added"
    if (index > 0 && index % (options.yieldEvery ?? 250) === 0) await yieldControl()
  }
  const uncertainPrevious = new Set(uncertainCandidates.map((candidate) => candidate.previousSliceId))
  for (const left of previous) if (!matchedPrevious.has(left.id)) left.revisionState = uncertainPrevious.has(left.id) ? "unmatched" : "removed"
  const counts = Object.fromEntries(states.map((state) => [state, 0])) as Record<RevisionState, number>
  for (const slice of current) counts[slice.revisionState] += 1
  for (const slice of previous) if (slice.revisionState === "removed") counts.removed += 1
  return { mappings, previous, current, uncertainCandidates, counts }
}

function cloneSlice(slice: ArtifactSlice): ArtifactSlice { return { ...slice, source: { ...slice.source }, preview: { ...slice.preview }, findingIds: [...slice.findingIds] } }
function sameLocation(left: ArtifactSlice, right: ArtifactSlice): boolean { return left.source.path === right.source.path && left.source.locator === right.source.locator }
function groupBy(items: readonly ArtifactSlice[], key: (item: ArtifactSlice) => string): Map<string, ArtifactSlice[]> { const groups = new Map<string, ArtifactSlice[]>(); for (const item of items) { const group = groups.get(key(item)) ?? []; group.push(item); groups.set(key(item), group) } return groups }
function indexCandidates(items: readonly ArtifactSlice[], used: ReadonlySet<string>): Map<string, ArtifactSlice[]> { const index = new Map<string, ArtifactSlice[]>(); for (const item of items) if (!used.has(item.id)) for (const token of titleTokens(item.title)) { const group = index.get(token) ?? []; group.push(item); index.set(token, group) } return index }
function selectCandidates(slice: ArtifactSlice, index: Map<string, ArtifactSlice[]>, used: ReadonlySet<string>, limit: number): ArtifactSlice[] { const result = new Map<string, ArtifactSlice>(); for (const token of titleTokens(slice.title)) for (const candidate of index.get(token) ?? []) { if (!used.has(candidate.id)) result.set(candidate.id, candidate); if (result.size >= limit) return [...result.values()] } return [...result.values()] }
function titleTokens(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2).slice(0, 12) }
function similarity(left: ArtifactSlice, right: ArtifactSlice): number { const title = jaccard(titleTokens(left.title), titleTokens(right.title)); const content = jaccard(words(left.content), words(right.content)); return Number((title * 0.45 + content * 0.55).toFixed(4)) }
function words(value: string): string[] { return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2).slice(0, 600))] }
function jaccard(left: string[], right: string[]): number { const a = new Set(left); const b = new Set(right); if (!a.size && !b.size) return 1; let common = 0; for (const value of a) if (b.has(value)) common += 1; return common / (a.size + b.size - common) }
function yieldControl(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)) }
