import { evidenceFileNames, type EvidenceExportData, type EvidenceFile, type EvidencePackage } from "./contracts.ts";
import {
  createFindingsCsv,
  createFindingsJson,
  createReviewHistoryJson,
  createReviewSummary,
  createSliceManifestJson,
  createSourceManifestJson,
} from "./serialize.ts";
import { validateEvidenceExport } from "./validation.ts";
import { createStoredZip } from "./zip.ts";

const encoder = new TextEncoder();

export function createEvidencePackage(data: EvidenceExportData): EvidencePackage {
  validateEvidenceExport(data);
  const files: EvidenceFile[] = [
    textFile(evidenceFileNames[0], createReviewSummary(data)),
    textFile(evidenceFileNames[1], createFindingsCsv(data.findings)),
    textFile(evidenceFileNames[2], createReviewHistoryJson(data)),
    textFile(evidenceFileNames[3], createSliceManifestJson(data)),
    textFile(evidenceFileNames[4], createSourceManifestJson(data)),
  ];
  return { files, zip: createStoredZip(files, data.reviewDates.exportedAt) };
}

export function createFindingsRegister(data: EvidenceExportData, format: "csv" | "json"): Uint8Array {
  validateEvidenceExport(data);
  const content = format === "csv" ? createFindingsCsv(data.findings) : createFindingsJson(data.findings);
  return encoder.encode(content);
}

function textFile(name: EvidenceFile["name"], content: string): EvidenceFile {
  return { name, content: encoder.encode(content) };
}
