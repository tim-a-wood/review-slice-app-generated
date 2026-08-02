import {
  evidencePackageFileNames,
  type EvidenceDownload,
  type EvidenceExportData,
  type EvidenceExportResult,
  type EvidenceExportService,
  type EvidenceFile,
  type EvidenceFileName,
  type EvidencePackage,
} from "./contracts.ts";
import {
  calculateEvidenceCounts,
  createFindingsCsv,
  createFindingsJson,
  createReviewHistoryJson,
  createReviewSummary,
  createSliceManifestJson,
  createSourceManifestJson,
  sha256Bytes,
} from "./serialize.ts";
import { diagnoseEvidenceExport, validateEvidenceExport } from "./validation.ts";
import { createStoredZip } from "./zip.ts";

const encoder = new TextEncoder();

/** The approved headless provider factory used by the application composition. */
export function createEvidenceExport(): EvidenceExportService {
  return Object.freeze({
    execute: createEvidenceArtifacts,
    exportEvidence: createEvidenceArtifacts,
    createPackage: createEvidencePackage,
    createFindingsRegister,
    diagnose: diagnoseEvidenceExport,
    validate: validateEvidenceExport,
  });
}

export function createEvidenceArtifacts(data: EvidenceExportData): EvidenceExportResult {
  const evidencePackage = createEvidencePackage(data);
  const findingsJson = download("findings.json", "application/json;charset=utf-8", encoder.encode(createFindingsJson(data)));
  const packageDownloads = evidencePackage.files.map((file) => ({ ...file } satisfies EvidenceDownload));
  const zipDownload = download("review-evidence.zip", "application/zip", evidencePackage.zip);
  const downloads = [
    packageDownloads[0],
    packageDownloads[1],
    findingsJson,
    packageDownloads[2],
    packageDownloads[3],
    packageDownloads[4],
    zipDownload,
  ];
  return { counts: calculateEvidenceCounts(data), downloads, evidencePackage };
}

export function createEvidencePackage(data: EvidenceExportData): EvidencePackage {
  validateEvidenceExport(data);
  const serialized: Readonly<Record<EvidenceFileName, string>> = {
    "review-summary.md": createReviewSummary(data),
    "findings.csv": createFindingsCsv(data),
    "review-history.json": createReviewHistoryJson(data),
    "slice-manifest.json": createSliceManifestJson(data),
    "source-manifest.json": createSourceManifestJson(data),
  };
  const mediaTypes: Readonly<Record<EvidenceFileName, string>> = {
    "review-summary.md": "text/markdown;charset=utf-8",
    "findings.csv": "text/csv;charset=utf-8",
    "review-history.json": "application/json;charset=utf-8",
    "slice-manifest.json": "application/json;charset=utf-8",
    "source-manifest.json": "application/json;charset=utf-8",
  };
  const files = evidencePackageFileNames.map((name) => file(name, mediaTypes[name], encoder.encode(serialized[name])));
  const zip = createStoredZip(files, data.reviewDates.exportedAt);
  return { files, zip, contentHash: sha256Bytes(zip) };
}

export function createFindingsRegister(data: EvidenceExportData, format: "csv" | "json"): Uint8Array {
  validateEvidenceExport(data);
  return encoder.encode(format === "csv" ? createFindingsCsv(data) : createFindingsJson(data));
}

function file(name: EvidenceFileName, mediaType: string, content: Uint8Array): EvidenceFile {
  return { name, mediaType, content, contentHash: sha256Bytes(content) };
}

function download(name: EvidenceDownload["name"], mediaType: string, content: Uint8Array): EvidenceDownload {
  return { name, mediaType, content, contentHash: sha256Bytes(content) };
}
