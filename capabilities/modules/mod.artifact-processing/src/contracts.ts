export const ARTIFACT_KINDS = [
  "markdown", "text", "docx", "pdf", "csv", "json", "xml", "diff", "source-directory",
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]
export type SliceStrategy = "auto" | "heading" | "paragraph" | "numbered-section" | "requirement" | "row" | "object" | "element" | "file" | "function" | "diff-hunk" | "manual"
export type ReviewState = "not-reviewed" | "accepted" | "finding" | "question" | "skipped" | "re-review-required"
export type RevisionState = "unchanged" | "modified" | "added" | "removed" | "relocated" | "unmatched"
export type CoordinateSystem = "decoded-text" | "extracted-docx-text" | "extracted-pdf-text"

export interface SourceLocation {
  path: string
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
  locator?: string
  coordinateSystem: CoordinateSystem
}

export interface ArtifactSlice {
  id: string
  matchKey: string
  artifactId: string
  sourceHash: string
  contentHash: string
  title: string
  content: string
  parentId: string | null
  sequence: number
  source: SourceLocation
  preview: { excerpt: string; characterCount: number; lineCount: number }
  reviewState: ReviewState
  revisionState: RevisionState
  findingIds: string[]
  createdAt: string
  updatedAt: string
  previousSliceId?: string
  previousReviewState?: ReviewState
}

export interface ArtifactSource {
  displayName: string
  relativePath: string
  bytes: Uint8Array
  kind?: ArtifactKind
}

export interface ArtifactInput {
  displayName: string
  source: ArtifactSource | readonly ArtifactSource[]
  kind?: ArtifactKind
  importedAt?: string
}

/** Serializable slicing input. Callers can persist it with the project. */
export interface SlicingOptions {
  strategy?: SliceStrategy
  headingDepth?: number
  combineBelowCharacters?: number
  splitAboveCharacters?: number
  manualBoundaries?: readonly number[]
  excludedMatchKeys?: readonly string[] | ReadonlySet<string>
  excludedTitles?: readonly string[]
}

export type ImportWarningCode =
  | "EMPTY_SOURCE" | "UNSUPPORTED_FILE" | "BINARY_FILE_SKIPPED" | "FILE_TOO_LARGE_SKIPPED"
  | "STRUCTURE_FALLBACK" | "DOCX_TEXT_LIMITED" | "PDF_TEXT_LIMITED" | "SLICE_COMBINED" | "SLICE_SPLIT" | "SLICE_EXCLUDED"
export interface ImportWarning { code: ImportWarningCode; message: string; sourcePath: string; recovery?: string }
export type ImportFailureCode = "UNSUPPORTED_FORMAT" | "INVALID_DOCX" | "PDF_TEXT_UNAVAILABLE" | "INVALID_CSV" | "INVALID_JSON" | "INVALID_XML" | "INVALID_DIFF" | "DIRECTORY_READ_FAILED" | "FILE_READ_FAILED" | "INVALID_SLICING_OPTIONS" | "INVALID_REVISION_MAPPING"

export class ArtifactImportError extends Error {
  readonly code: ImportFailureCode
  readonly sourcePath: string
  readonly recovery: string
  constructor(code: ImportFailureCode, message: string, sourcePath: string, recovery: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ArtifactImportError"
    this.code = code
    this.sourcePath = sourcePath
    this.recovery = recovery
  }
}

export interface SlicePreviewSummary {
  sliceCount: number
  totalCharacters: number
  estimatedMinutes: number
  oversizedSliceIds: string[]
  emptySectionCount: number
  excludedSectionCount: number
}

export interface ArtifactImportResult {
  artifact: { id: string; displayName: string; kind: ArtifactKind; sourceHash: string; importedAt: string; sourcePaths: string[] }
  slices: ArtifactSlice[]
  warnings: ImportWarning[]
  preview: SlicePreviewSummary
  slicing: NormalizedSlicingOptions
}

export interface NormalizedSlicingOptions {
  strategy: SliceStrategy
  headingDepth: number
  combineBelowCharacters: number
  splitAboveCharacters: number
  manualBoundaries: number[]
  excludedMatchKeys: string[]
  excludedTitles: string[]
}

export interface ReviewerMapping { previousSliceId: string; currentSliceId: string; correctedAt: string; userConfirmed?: boolean }
export interface ManualMappingSet {
  schemaVersion: "1.0"
  previousSliceSetHash: string
  currentSliceSetHash: string
  mappings: ReviewerMapping[]
  recordedAt: string
  contentHash: string
}
export interface RevisionCandidate { previousSliceId: string; currentSliceId: string; confidence: number; reason: "match-key" | "content-hash" | "fuzzy" | "reviewer" }
export interface RevisionMapping extends RevisionCandidate { revisionState: RevisionState; preservedReviewState: ReviewState; userConfirmed: boolean }
export interface RevisionComparison {
  mappings: RevisionMapping[]
  previous: ArtifactSlice[]
  current: ArtifactSlice[]
  uncertainCandidates: RevisionCandidate[]
  counts: Record<RevisionState, number>
  appliedManualMappings: ReviewerMapping[]
}
export interface CompareOptions {
  reviewerMappings?: readonly ReviewerMapping[]
  manualMappingSet?: ManualMappingSet
  fuzzyThreshold?: number
  uncertainThreshold?: number
  candidateLimit?: number
  yieldEvery?: number
}
export interface DirectoryImportOptions { ignoredNames?: readonly string[]; maximumFileBytes?: number }

export type ArtifactProcessingResult<T> = { ok: true; value: T; diagnostics: ImportWarning[] } | { ok: false; error: ArtifactImportError; diagnostics: ImportWarning[] }

export interface ArtifactProcessing {
  readonly moduleId: "mod.artifact-processing"
  readonly moduleVersion: "1.0.0"
  importArtifact(input: ArtifactInput, options?: SlicingOptions): Promise<ArtifactProcessingResult<ArtifactImportResult>>
  importLocalPath(path: string, options?: SlicingOptions, directoryOptions?: DirectoryImportOptions): Promise<ArtifactProcessingResult<ArtifactImportResult>>
  compareRevisions(previous: readonly ArtifactSlice[], current: readonly ArtifactSlice[], options?: CompareOptions): Promise<ArtifactProcessingResult<RevisionComparison>>
  createManualMappingSet(previous: readonly ArtifactSlice[], current: readonly ArtifactSlice[], mappings: readonly ReviewerMapping[], recordedAt: string): ManualMappingSet
  parseManualMappingSet(json: string): ManualMappingSet
}
