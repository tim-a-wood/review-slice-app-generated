import type {
  PersistedWorkflowEnvelope,
  ReviewWorkspaceSnapshot,
  WorkflowPersistencePort,
  WorkflowRecoveryMetadata,
} from "./contracts.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const emptySnapshot = (): ReviewWorkspaceSnapshot => ({
  schemaVersion: "1.0",
  generation: 0,
  projects: [],
});

function validEnvelope(value: PersistedWorkflowEnvelope | undefined): value is PersistedWorkflowEnvelope {
  return Boolean(
    value &&
      value.schemaVersion === "1.0" &&
      Number.isSafeInteger(value.generation) &&
      value.generation >= 0 &&
      value.snapshot?.schemaVersion === "1.0" &&
      value.snapshot.generation === value.generation &&
      Array.isArray(value.snapshot.projects),
  );
}

type Candidate = {
  source: "primary" | "backup";
  envelope?: PersistedWorkflowEnvelope;
  error?: string;
};

export class PersistenceCoordinator {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly port: WorkflowPersistencePort) {}

  public async load(now: string): Promise<{
    snapshot: ReviewWorkspaceSnapshot;
    recovery: WorkflowRecoveryMetadata;
  }> {
    const [primary, backup] = await Promise.all([
      this.read("primary", () => this.port.loadPrimary()),
      this.read("backup", () => this.port.loadBackup()),
    ]);
    const valid = [primary, backup]
      .filter((candidate): candidate is Candidate & { envelope: PersistedWorkflowEnvelope } => validEnvelope(candidate.envelope))
      .sort((left, right) => right.envelope.generation - left.envelope.generation || (left.source === "primary" ? -1 : 1));

    if (valid.length === 0) {
      if (primary.error && backup.error) {
        throw new Error(`Review state recovery failed. Primary: ${primary.error}. Backup: ${backup.error}.`);
      }
      const reason = [primary.error, backup.error].filter(Boolean).join(" ") || undefined;
      return {
        snapshot: emptySnapshot(),
        recovery: { source: "new", recovered: false, recoveredAt: now, ...(reason ? { reason } : {}) },
      };
    }

    const selected = valid[0];
    const primaryGeneration = validEnvelope(primary.envelope) ? primary.envelope.generation : undefined;
    const backupGeneration = validEnvelope(backup.envelope) ? backup.envelope.generation : undefined;
    const recovered = selected.source === "backup" || primary.error !== undefined || !validEnvelope(primary.envelope);
    const reason = recovered
      ? primary.error
        ? `The primary store could not be read: ${primary.error}`
        : "The backup contained the newest valid review state."
      : backup.error
        ? `The backup store could not be read: ${backup.error}`
        : undefined;
    return {
      snapshot: copy(selected.envelope.snapshot),
      recovery: {
        source: selected.source,
        recovered,
        recoveredAt: now,
        ...(primaryGeneration === undefined ? {} : { primaryGeneration }),
        ...(backupGeneration === undefined ? {} : { backupGeneration }),
        ...(reason ? { reason } : {}),
      },
    };
  }

  public save(snapshot: ReviewWorkspaceSnapshot, savedAt: string): Promise<void> {
    const envelope: PersistedWorkflowEnvelope = {
      schemaVersion: "1.0",
      generation: snapshot.generation,
      savedAt,
      snapshot: copy(snapshot),
    };
    const write = async (): Promise<void> => {
      await this.port.savePrimary(copy(envelope));
      await this.port.saveBackup(copy(envelope));
    };
    const result = this.writeQueue.then(write, write);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  private async read(source: Candidate["source"], load: () => Promise<PersistedWorkflowEnvelope | undefined>): Promise<Candidate> {
    try {
      return { source, envelope: await load() };
    } catch (error) {
      return { source, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function cloneWorkflowSnapshot(snapshot: ReviewWorkspaceSnapshot): ReviewWorkspaceSnapshot {
  return copy(snapshot);
}
