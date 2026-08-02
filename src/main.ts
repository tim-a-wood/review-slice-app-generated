import {
  ArtifactImportError,
  type ArtifactProcessing,
  type ArtifactProcessingResult,
} from "../capabilities/modules/mod.artifact-processing/src/contracts.ts";
import { evidenceFileNames } from "../capabilities/modules/mod.evidence-export/src/index.ts";
import {
  createUserWorkspaceServices,
  mountUserWorkspace,
} from "../capabilities/modules/mod.experience-first/src/index.ts";
import { FINDING_TYPES } from "../capabilities/modules/mod.findings/src/index.ts";
import { REVIEW_STATES } from "../capabilities/modules/mod.review-workflow/src/index.ts";
import type {
  ArtifactIpcResult,
  ArtifactSyncResult,
  ReviewSliceDesktopBridge,
  SerializedArtifactError,
} from "./types.ts";

const availableBridge = window.reviewSliceDesktop;
if (!availableBridge) throw new Error("The desktop bridge is unavailable.");
const bridge: ReviewSliceDesktopBridge = availableBridge;

const providerProvenance = Object.freeze({
  artifact: "mod.artifact-processing",
  evidence: evidenceFileNames[0],
  findings: FINDING_TYPES[0],
  workflow: REVIEW_STATES[0],
});

if (!providerProvenance.evidence || !providerProvenance.findings || !providerProvenance.workflow) {
  throw new Error("The approved module providers are unavailable.");
}

const artifact: ArtifactProcessing = {
  moduleId: "mod.artifact-processing",
  moduleVersion: "1.0.0",
  importArtifact: async (input, options) => hydrate(await bridge.artifact.importArtifact(input, options)),
  importLocalPath: async (_path, options, directoryOptions) => (
    hydrate(await bridge.artifact.importLocalArtifact(options, directoryOptions))
  ),
  compareRevisions: async (previous, current, options) => (
    hydrate(await bridge.artifact.compareRevisions(previous, current, options))
  ),
  createManualMappingSet: (previous, current, mappings, recordedAt) => unwrap(
    bridge.artifact.createManualMappingSet(previous, current, mappings, recordedAt),
  ),
  parseManualMappingSet: (json) => unwrap(bridge.artifact.parseManualMappingSet(json)),
};

function deserializeError(value: SerializedArtifactError): ArtifactImportError {
  return new ArtifactImportError(value.code, value.message, value.sourcePath, value.recovery);
}

function hydrate<T>(result: ArtifactIpcResult<T>): ArtifactProcessingResult<T> {
  if (result.ok) return result;
  return { ...result, error: deserializeError(result.error) };
}

function unwrap<T>(result: ArtifactSyncResult<T>): T {
  if (result.ok) return result.value;
  throw deserializeError(result.error);
}

async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("The application mount is unavailable.");
  const dataPath = await bridge.dataPath();
  const services = await createUserWorkspaceServices({ artifact, storage: window.localStorage });
  mountUserWorkspace(root, {
    services,
    dataPath,
    storage: window.localStorage,
    saveFile: (name, content, mediaType) => bridge.saveFile(name, content, mediaType),
  });
}

void start().catch((cause: unknown) => {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) root.dataset.compositionError = "true";
  console.error(cause);
});
