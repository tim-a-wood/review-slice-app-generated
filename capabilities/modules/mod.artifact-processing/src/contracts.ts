export const ARTIFACT_KINDS = [
  "markdown", "text", "docx", "pdf", "csv", "json", "xml", "diff", "source-directory",
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]
export type SliceStrategy = "auto" | "heading" | "paragraph" | "row" | "object" | "element" | "file" | "function" | "diff-hunk" | "manual"
export type ReviewState = "not-reviewed" | "accepted" | "finding" | "question" | "skipped" | "re-review-required"
export type RevisionState = "unchanged" | "modified" | "added" | "removed" | "relocated" | "unmatched"

export interface SourceLocation {
  path: string
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
  locator?: string
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

export interface SlicingOptions {
  strategy?: SliceStrategy
  headingDepth?: number
  combineBelowCharacters?: number
  splitAboveCharacters?: number
  manualBoundaries?: readonly number[]
  excludedMatchKeys?: ReadonlySet<string>
  excludedTitles?: readonly string[]
}

export type ImportWarningCode = "EMPTY_SOURCE" | "UNSUPPORTED_FILE" | "BINARY_FILE_SKIPPED" | "STRUCTURE_FALLBACK" | "PDF_TEXT_LIMITED" | "SLICE_COMBINED" | "SLICE_SPLIT" | "SLICE_EXCLUDED"
export interface ImportWarning { code: ImportWarningCode; message: string; sourcePath: string; recovery?: string }
export type ImportFailureCode = "UNSUPPORTED_FORMAT" | "INVALID_DOCX" | "PDF_TEXT_UNAVAILABLE" | "INVALID_CSV" | "INVALID_JSON" | "INVALID_XML" | "INVALID_DIFF" | "DIRECTORY_READ_FAILED" | "FILE_READ_FAILED"

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

export interface ArtifactImportResult {
  artifact: { id: string; displayName: string; kind: ArtifactKind; sourceHash: string; importedAt: string; sourcePaths: string[] }
  slices: ArtifactSlice[]
  warnings: ImportWarning[]
}

export interface ReviewerMapping { previousSliceId: string; currentSliceId: string; correctedAt: string }
export interface RevisionCandidate { previousSliceId: string; currentSliceId: string; confidence: number; reason: "match-key" | "content-hash" | "fuzzy" | "reviewer" }
export interface RevisionMapping extends RevisionCandidate { revisionState: RevisionState; preservedReviewState: ReviewState }
export interface RevisionComparison {
  mappings: RevisionMapping[]
  previous: ArtifactSlice[]
  current: ArtifactSlice[]
  uncertainCandidates: RevisionCandidate[]
  counts: Record<RevisionState, number>
}
export interface CompareOptions {
  reviewerMappings?: readonly ReviewerMapping[]
  fuzzyThreshold?: number
  uncertainThreshold?: number
  candidateLimit?: number
  yieldEvery?: number
}
export interface DirectoryImportOptions { ignoredNames?: readonly string[]; maximumFileBytes?: number }

export interface ProcessingViewState {
  phase: "select" | "detect" | "preview" | "confirm"
  artifactName?: string
  detectedKind?: ArtifactKind
  options: SlicingOptions
  result?: ArtifactImportResult
  error?: ArtifactImportError
  busy?: boolean
}
export interface ProcessingViewActions {
  selectFile(): void | Promise<void>
  selectDirectory(): void | Promise<void>
  detectStructure(): void | Promise<void>
  previewSlices(options: SlicingOptions): void | Promise<void>
  confirmProject(): void | Promise<void>
  retryImport(): void | Promise<void>
}
