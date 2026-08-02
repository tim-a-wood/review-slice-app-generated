# Artifact processing

`mod.artifact-processing` is the headless Review Slice domain module for immutable local artifact import, deterministic slicing, and revision comparison. Presentation belongs only to `mod.experience-first`; `ui.ts` and `styles.css` are retained as neutral compatibility files and contain no interface.

## Public entry point

Import `createArtifactProcessing` from `src/index.ts`. The factory returns result-based operations for in-memory sources, local files and directories, revision comparison, and durable manual mapping sets. Direct throwing functions remain exported for the Electron adapter.

## Supported sources

- Markdown and plain text
- DOCX document text
- Text-based PDF streams (no OCR)
- CSV, JSON, and XML
- Git patches and unified diffs with Git file headers
- Local source-code directories

Every slice records the normalized source path, exact offsets and line numbers in its declared coordinate system, an original-source SHA-256 hash, and an exact slice-content SHA-256 hash. DOCX and PDF locations explicitly use extracted-text coordinates because archive bytes and PDF drawing operators do not share decoded-text offsets.

## Determinism and source safety

The module reads source bytes and never writes them. It sorts directory entries, normalizes paths, validates slicing settings, assigns duplicate-safe structural match keys, and derives identities and hashes without wall-clock input. Import time is metadata supplied by the caller or recorded once at import.

## Revision decisions

Comparison applies user-confirmed mappings first, then structural keys, exact content hashes, and bounded fuzzy candidates. It reports unchanged, modified, added, removed, relocated, and unmatched content independently of review disposition. Unchanged and relocated slices retain their disposition and finding links. Modified and uncertain slices require review. Added slices begin as not reviewed.

Manual mapping sets are serializable, hash-bound to both slice sets, and validated for missing, duplicate, or stale mappings before comparison. The project persistence owner stores that JSON with the revision record.

## Diagnostics

Recoverable import failures contain a stable code, source path, and recovery action. Scanned PDFs fail honestly with `PDF_TEXT_UNAVAILABLE`; the module does not perform OCR or network access. Large or binary directory files are reported as warnings instead of being silently included.
