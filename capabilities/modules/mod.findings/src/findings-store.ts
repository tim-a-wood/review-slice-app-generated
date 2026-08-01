import type {
  CreateFindingInput,
  Finding,
  FindingFilter,
  FindingHistory,
  FindingStatus,
  FindingsPersistence,
  SourceNavigator,
  UpdateFindingInput,
} from "./contracts.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FindingsStore {
  private findings: Finding[] = [];
  private write = Promise.resolve();
  private readonly persistence: FindingsPersistence;
  private readonly navigator: SourceNavigator;
  private readonly now: () => string;
  private readonly nextId: () => string;

  public constructor(
    persistence: FindingsPersistence,
    navigator: SourceNavigator,
    now: () => string,
    nextId: () => string,
  ) {
    this.persistence = persistence;
    this.navigator = navigator;
    this.now = now;
    this.nextId = nextId;
  }

  public async load(): Promise<void> {
    this.findings = copy(await this.persistence.load());
  }

  public list(filter: FindingFilter = {}): Finding[] {
    const query = filter.query?.trim().toLowerCase();
    return this.findings
      .filter((finding) => {
        const searchable = `${finding.id} ${finding.description} ${finding.source.title} ${finding.source.location}`.toLowerCase();
        return (!query || searchable.includes(query)) &&
          (!filter.status || finding.status === filter.status) &&
          (!filter.type || finding.type === filter.type) &&
          (!filter.severity || finding.severity === filter.severity) &&
          (!filter.sliceId || finding.source.sliceId === filter.sliceId);
      })
      .map(copy);
  }

  public get(id: string): Finding | undefined {
    const finding = this.findings.find((item) => item.id === id);
    return finding ? copy(finding) : undefined;
  }

  public async create(input: CreateFindingInput): Promise<Finding> {
    this.requireText(input.description, "Description");
    this.requireSource(input.source.sliceId, "Slice ID");
    const at = this.now();
    const finding: Finding = {
      ...copy(input),
      id: this.nextId(),
      status: "Open",
      createdAt: at,
      updatedAt: at,
      history: [this.history("Created", "Open", at)],
    };
    await this.change(() => this.findings.push(finding));
    return copy(finding);
  }

  public async update(id: string, input: UpdateFindingInput): Promise<Finding> {
    if (input.description !== undefined) this.requireText(input.description, "Description");
    return this.mutate(id, "Updated", undefined, (finding) => Object.assign(finding, copy(input)));
  }

  public async setStatus(id: string, status: FindingStatus, note?: string): Promise<Finding> {
    return this.mutate(id, "Status changed", note, (finding) => { finding.status = status; });
  }

  public async verify(id: string, revisionId: string, note?: string): Promise<Finding> {
    this.requireText(revisionId, "Revision ID");
    return this.mutate(id, "Verified", note, (finding) => {
      finding.status = "Verified";
      finding.verifiedRevisionId = revisionId;
      finding.verifiedAt = this.now();
    });
  }

  public async openSource(id: string): Promise<void> {
    const finding = this.findings.find((item) => item.id === id);
    if (!finding) throw new Error(`Finding ${id} does not exist.`);
    await this.navigator.openSource(copy(finding.source));
  }

  private async mutate(
    id: string,
    action: FindingHistory["action"],
    note: string | undefined,
    edit: (finding: Finding) => void,
  ): Promise<Finding> {
    let result: Finding | undefined;
    await this.change(() => {
      const finding = this.findings.find((item) => item.id === id);
      if (!finding) throw new Error(`Finding ${id} does not exist.`);
      edit(finding);
      const at = this.now();
      finding.updatedAt = at;
      finding.history = [...finding.history, this.history(action, finding.status, at, note)];
      result = copy(finding);
    });
    return result as Finding;
  }

  private async change(edit: () => void): Promise<void> {
    this.write = this.write.then(async () => {
      const draft = copy(this.findings);
      edit();
      try {
        await this.persistence.save(copy(this.findings));
      } catch (error) {
        this.findings = draft;
        throw error;
      }
    });
    return this.write;
  }

  private history(action: FindingHistory["action"], status: FindingStatus, at: string, note?: string): FindingHistory {
    return { action, status, at, ...(note ? { note } : {}) };
  }

  private requireText(value: string, label: string): void {
    if (!value.trim()) throw new Error(`${label} is required.`);
  }

  private requireSource(value: string, label: string): void {
    if (!value.trim()) throw new Error(`${label} is required.`);
  }
}
