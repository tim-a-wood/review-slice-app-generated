# Review Slice

Review Slice is a local desktop application for source-linked technical reviews.
The application stores review state in the Electron user data directory.
The application writes a primary JSON file and a recoverable backup.

## Run application

Install dependencies in the repository directory.

```bash
npm ci
npm run dev
```

## Verify source code

Run the complete local verification suite.

```bash
npm run verify
```

## Build Windows package

Create the portable Windows x64 ZIP.

```bash
npm run dist:win
```

The build creates `release/Review-Slice-1.0.0-x64.zip`.

## Windows deployment

1. Copy `Review-Slice-1.0.0-x64.zip` to the Windows 11 computer.
2. Extract the ZIP to a local directory.
3. Open the extracted directory.
4. Run `Review Slice.exe`.

Keep all extracted files in the same directory.
The application does not need a network connection.
The first launch opens an empty local workspace. Import an artifact to create the first review project.

## Review visual references

Files in `docs/evidence` can show the interface from an earlier run.
Treat these files as visual references only.
Do not use these files as current release evidence.

## Review governed evidence

Create a new Assured run for each release.
Use the completion record, timeline, verification results, and captured views from that run as governed records.
Match the source revision and package hash before release approval.

## Find local data

The dashboard and review workspace show the local data path.
Review projects, backup state, and findings remain inside Electron's local user-data directory.
The export action creates an evidence ZIP through a local save dialog.
