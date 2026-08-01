# Artifact processing

This module imports local artifacts into deterministic source-linked slices.
It does not write to imported sources.

## Public interface

Use `importArtifact` for in-memory source bytes.
Use `importLocalPath` for a local file or source directory.
Use `compareRevisions` for revision classifications and reviewer mappings.
Use `mountArtifactProcessing` to mount the four-phase user interface.

The module supports Markdown, text, DOCX, text-based PDF, CSV, JSON, XML, unified diff, and source directories.
The DOCX parser reads `word/document.xml` from standard ZIP packages.
The PDF parser reads supported literal text operators from text streams.
The parser reports an actionable failure when a source lacks supported text.

## Deterministic behavior

The module hashes source bytes and slice content with SHA-256.
The module sorts directory paths before it creates slices.
The module uses structural match keys before it evaluates content hashes.
The comparison uses bounded title and content candidates for uncertain mappings.
Reviewer mappings take priority over automatic mappings.

## Integration note

The handoff snapshot contains only `PRD.md`.
It does not contain frozen contracts or root build scripts.
Apply this overlay to the target repository before you run repository verification.
