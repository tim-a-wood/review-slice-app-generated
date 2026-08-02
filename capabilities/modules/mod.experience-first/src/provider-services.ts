import type { ArtifactProcessing } from "../../mod.artifact-processing/src/contracts.ts";
import { createEvidenceExport } from "../../mod.evidence-export/src/evidence-export.ts";
import { createFindingsManagement } from "../../mod.findings/src/index.ts";
import type { FindingsSnapshot } from "../../mod.findings/src/contracts.ts";
import { createReviewWorkflow } from "../../mod.review-workflow/src/index.ts";
import type {
  PersistedWorkflowEnvelope,
  WorkflowPersistencePort,
} from "../../mod.review-workflow/src/contracts.ts";
import type { UserWorkspaceOptions, WorkspaceServices } from "./contracts.ts";

const PRIMARY_WORKFLOW = "review-slice.workflow.primary.v1";
const BACKUP_WORKFLOW = "review-slice.workflow.backup.v1";
const FINDINGS = "review-slice.findings.v1";
const BACKUP_FINDINGS = "review-slice.findings.backup.v1";

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

function parse<T>(store: KeyValueStore, key: string): T | undefined {
  const value = store.getItem(key);
  if (!value) return undefined;
  try { return JSON.parse(value) as T; }
  catch (cause) { throw new Error(`The local ${key} record is not valid JSON. Restore the backup or start a new project.`, { cause }); }
}

function workflowPersistence(store: KeyValueStore): WorkflowPersistencePort {
  return {
    loadPrimary: async () => parse<PersistedWorkflowEnvelope>(store, PRIMARY_WORKFLOW),
    loadBackup: async () => parse<PersistedWorkflowEnvelope>(store, BACKUP_WORKFLOW),
    savePrimary: async (value) => { store.setItem(PRIMARY_WORKFLOW, JSON.stringify(value)); },
    saveBackup: async (value) => { store.setItem(BACKUP_WORKFLOW, JSON.stringify(value)); },
  };
}

export interface CreateUserWorkspaceServicesOptions extends Pick<UserWorkspaceOptions, "storage" | "seedDemo"> {
  /** The composition adapter supplies a browser-safe artifact service. */
  artifact: ArtifactProcessing;
}

/** Realize the renderer-local services around the injected artifact boundary. */
export async function createUserWorkspaceServices(options: CreateUserWorkspaceServicesOptions): Promise<WorkspaceServices> {
  const store: KeyValueStore = options.storage ?? new MemoryStore();
  const artifact = options.artifact;
  const evidence = createEvidenceExport();
  const workflow = await createReviewWorkflow({ persistence: workflowPersistence(store) });
  const findings = await createFindingsManagement({
    persistence: findingsPersistence(store),
    navigator: { openSource: async () => undefined },
  });
  if (options.seedDemo) await seedDemonstrationProject(workflow, findings);
  return { artifact, workflow, findings, evidence };
}

function findingsPersistence(store: KeyValueStore) {
  return {
    load: async (): Promise<FindingsSnapshot | undefined> => {
      const primary = readFindings(store, FINDINGS);
      const backup = readFindings(store, BACKUP_FINDINGS);
      const valid = [primary, backup]
        .filter((candidate): candidate is { value: FindingsSnapshot; error?: never } => candidate.value !== undefined)
        .sort((left, right) => right.value.generation - left.value.generation);
      if (valid[0]) return valid[0].value;
      const errors = [primary.error, backup.error].filter((value): value is string => Boolean(value));
      if (errors.length) throw new Error(`Finding state recovery failed. ${errors.join(" ")}`);
      return undefined;
    },
    save: async (value: FindingsSnapshot): Promise<void> => {
      const serialized = JSON.stringify(value);
      store.setItem(BACKUP_FINDINGS, serialized);
      store.setItem(FINDINGS, serialized);
    },
  };
}

function readFindings(store: KeyValueStore, key: string): { value?: FindingsSnapshot; error?: string } {
  const serialized = store.getItem(key);
  if (!serialized) return {};
  try {
    const value = JSON.parse(serialized) as Partial<FindingsSnapshot>;
    if (value.schemaVersion !== "1.0" || !Number.isSafeInteger(value.generation) || !Array.isArray(value.findings)) {
      return { error: `${key} is not a supported finding snapshot.` };
    }
    return { value: value as FindingsSnapshot };
  } catch (cause) {
    return { error: `${key} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

async function seedDemonstrationProject(
  workflow: Awaited<ReturnType<typeof createReviewWorkflow>>,
  findings: Awaited<ReturnType<typeof createFindingsManagement>>,
): Promise<void> {
  if (workflow.listProjects({ includeArchived: true }).length) return;
  const importedAt = "2026-07-31T14:22:00.000Z";
  await workflow.createProject({
    id: "project-flight-controls",
    name: "Flight Control Requirements Review",
    description: "System requirements baseline review for release 2.4.",
    initialRevision: {
      id: "revision-b",
      label: "Revision B",
      fileName: "flight-control-requirements.md",
      fileHash: "9573c45ef136abe1e51676a62208944f3cfc3db3568790fe2c0f4e672c550f27",
      artifactType: "markdown",
      parserVersion: "1.0.0",
      importedAt,
      slices: demoSlices(),
    },
  });
  if (findings.list().length) return;
  await findings.create({
    id: "FND-001",
    type: "Defect",
    severity: "Major",
    description: "The actuator limit does not state an angular unit.",
    source: source("slice-control-limit", "§ 3.2 · Lines 42–48", "Actuator command limit"),
  });
  const question = await findings.create({
    id: "FND-002",
    type: "Question",
    severity: "Minor",
    description: "Confirm whether degraded-mode timing includes sensor settling time.",
    source: source("slice-degraded-mode", "§ 4.1 · Lines 76–88", "Degraded-mode response"),
  });
  await findings.transitionStatus(question.id, "Addressed", "The system owner supplied a response for Revision B.");
  await findings.create({
    id: "FND-003",
    type: "Traceability issue",
    severity: "Minor",
    description: "The verification method does not reference the linked test procedure.",
    source: source("slice-verification", "§ 7.4 · Lines 161–173", "Verification evidence"),
  });
}

function source(sliceId: string, location: string, title: string) {
  return {
    projectId: "project-flight-controls",
    revisionId: "revision-b",
    artifactId: "artifact-flight-controls-b",
    sliceId,
    path: "flight-control-requirements.md",
    location,
    locator: location.split(" · ")[0],
    title,
  };
}

function demoSlices() {
  const content = [
    ["slice-purpose", "document:purpose", "Purpose and scope", "This specification defines the command, monitoring, and fault-response behavior of the flight-control computer.", "§ 1.0 · Lines 1–12", "accepted", "unchanged"],
    ["slice-interfaces", "req:FCR-012", "Sensor input interfaces", "FCR-012: The flight-control computer shall sample each active position sensor at 100 Hz and record the selected source.", "§ 2.3 · Lines 25–37", "accepted", "unchanged"],
    ["slice-control-limit", "req:FCR-021", "Actuator command limit", "FCR-021: The commanded actuator position shall remain within the configured limit for every operating mode.", "§ 3.2 · Lines 42–48", "finding", "modified"],
    ["slice-command-authority", "req:FCR-024", "Command authority", "FCR-024: The computer shall reject a command that exceeds the authority assigned to the active control channel.", "§ 3.4 · Lines 55–63", "not-reviewed", "added"],
    ["slice-degraded-mode", "req:FCR-031", "Degraded-mode response", "FCR-031: After a confirmed sensor fault, the computer shall enter degraded mode within 120 milliseconds.", "§ 4.1 · Lines 76–88", "question", "relocated"],
    ["slice-recovery", "req:FCR-044", "State recovery", "FCR-044: After an unexpected closure, the application shall restore the last committed review state from the primary record or its backup.", "§ 5.5 · Lines 112–124", "accepted", "unchanged"],
    ["slice-calibration", "req:FCR-052", "Calibration appendix", "The calibration appendix is informative and is excluded from this requirements review.", "Appendix A · Lines 138–149", "skipped", "unchanged"],
    ["slice-verification", "req:FCR-067", "Verification evidence", "FCR-067: Each safety requirement shall identify its verification method and the retained evidence artifact.", "§ 7.4 · Lines 161–173", "re-review-required", "modified"],
  ] as const;
  return content.map(([id, stableMatchKey, title, text, location, reviewState, revisionState], index) => ({
    id,
    stableMatchKey,
    title,
    content: text,
    contentHash: `demo-content-${index + 1}`,
    sequence: index,
    source: {
      artifactId: "artifact-flight-controls-b",
      path: "flight-control-requirements.md",
      location,
      locator: location.split(" · ")[0],
    },
    reviewState,
    revisionState,
  }));
}
