# Review Slice — Product Requirements Document

## Product intent

Review Slice is a local, single-user desktop application that turns a large technical review into a finite, persistent queue of source-linked sections. It must show what was reviewed, what remains, what findings were raised, what changed in a later revision, what must be reviewed again, and what evidence demonstrates completion.

The initial target is Windows 11. The application must work without a network connection, never modify an imported source, save immediately, recover safely after closure, expose its local data location, and maintain backups.

## Users and principles

The primary user is a technical professional reviewing requirements, designs, verification procedures, test specifications, standards, plans, pull requests, source code, configuration, or generated engineering documentation.

The product is deterministic, source-preserving, resumable, traceable, revision-aware, and low-friction. It has no accounts, cloud synchronization, collaboration, OCR, AI analysis, formal signatures, or source editing.

## MVP inputs and slicing

The MVP imports Markdown, plain text, DOCX, text-based PDF, CSV, JSON, XML, Git patches/unified diffs, and local source-code directories. Sensible deterministic defaults are selected per type:

- documents by heading, numbered section, requirement identifier, paragraph block, or manual boundary;
- structured data by CSV row, JSON object, or XML element;
- code and changes by file, class, function/method, or diff hunk.

The four-step import flow selects the artifact, detects structure, previews generated slices, and confirms the project. Users can adjust strategy and heading depth, combine small slices, split oversized slices, exclude sections, and inspect warnings before confirmation.

Every slice has a stable identifier and match key, source artifact and location, display title, content and hash, parent, sequence, review state, revision state, findings, and timestamps.

## Core workflow

The project dashboard shows active and recent reviews, completion, remaining slices, open findings, required re-reviews, and last activity. It provides New Review, Open Review, Import Revision, View Findings, and Export Report actions.

The review workspace has three regions:

1. A left navigator containing hierarchy, slice titles, review and revision status, finding count, and filters.
2. A read-only center source viewer containing the current slice, source location, prior content and inline differences when applicable, and the previous disposition.
3. A right action rail containing Accept, Add Finding, Add Question, Skip, Add Note, Previous, and Next.

Keyboard shortcuts support A (accept), F (finding), Q (question), S (skip), J (next), and K (previous).

Each slice has one review state: Not Reviewed, Accepted, Finding, Question, Skipped (with reason), or Re-review Required. It independently has a revision state: Unchanged, Modified, Added, Removed, Relocated, or Unmatched.

## Findings

A finding has an identifier, type, description, lifecycle status, source slice and location, and creation date. Types are Defect, Question, Improvement, Inconsistency, Missing information, Traceability issue, Editorial issue, and Other. Statuses are Open, Addressed, Verified, Rejected, and Deferred. Optional fields include severity, resolution, external reference, related finding, and evidence attachment.

The findings register is searchable and filterable and supports status updates, source navigation, resolution notes, later-revision verification, and export.

## Revision comparison

When the user imports a new revision, the app deterministically re-slices it, maps slices using stable keys, content hashes, relocation checks, and bounded fuzzy candidates, and classifies every slice. Accepted decisions are preserved for unchanged or relocated content. Modified, added, and uncertain content enters the review queue. Findings and history remain intact. Removed and unmatched content is visible, and uncertain mappings can be corrected manually.

## Persistence, evidence, and exports

Every decision and finding is saved automatically. A reopened project must reproduce the exact prior state. The primary store is local and uses atomic writes plus a recoverable backup.

Exports include Markdown review summaries and CSV/JSON findings. A complete evidence ZIP contains:

- `review-summary.md`
- `findings.csv`
- `review-history.json`
- `slice-manifest.json`
- `source-manifest.json`

The review summary includes project and revision metadata, dates, slice totals, completion, disposition and revision breakdowns, finding totals, unresolved questions, and skipped reasons.

## Quality and acceptance

- A project with 5,000 slices opens in under five seconds on a normal development laptop.
- Navigation has no noticeable delay and revision comparison does not block the UI.
- Imported source files are never modified.
- Parsing failures are explicit and actionable.
- A user can review a 100-section document across sessions, reopen linked findings, identify exactly what remains, import a revision, avoid re-reviewing unchanged content, export complete evidence, and use the application fully offline.
- The repository includes maintainable TypeScript boundaries, automated tests for deterministic slicing/comparison/export, Windows installer configuration, and a Windows CI release workflow.
