import { Clock, IdentifierSource, ReviewProject, ReviewSlice, ReviewState } from "./contracts";
import { PersistenceCoordinator } from "./persistence";

export class ReviewWorkflow {
  private readonly index = new Map<string, number>();

  private constructor(
    private project: ReviewProject,
    private readonly persistence: PersistenceCoordinator,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierSource,
  ) {
    project.slices.forEach((slice, position) => this.index.set(slice.id, position));
  }

  public static async create(
    project: Omit<ReviewProject, "createdAt" | "updatedAt" | "history">,
    persistence: PersistenceCoordinator,
    clock: Clock,
    identifiers: IdentifierSource,
  ): Promise<ReviewWorkflow> {
    const slices = [...project.slices].sort((left, right) => left.sequence - right.sequence);
    assertValidSlices(slices);
    const now = clock.now();
    const workflow = new ReviewWorkflow({ ...project, slices, createdAt: now, updatedAt: now, history: [] }, persistence, clock, identifiers);
    await persistence.save(workflow.project);
    return workflow;
  }

  public static async resume(
    projectId: string,
    persistence: PersistenceCoordinator,
    clock: Clock,
    identifiers: IdentifierSource,
  ): Promise<ReviewWorkflow | undefined> {
    const result = await persistence.resume(projectId);
    if (!result.project) return undefined;
    const workflow = new ReviewWorkflow(result.project, persistence, clock, identifiers);
    if (result.recovered) await workflow.record("", "recovery", "backup-restored");
    return workflow;
  }

  public snapshot(): ReviewProject { return this.project; }

  public activeSlice(): ReviewSlice | undefined {
    return this.project.activeSliceId ? this.slice(this.project.activeSliceId) : undefined;
  }

  public async select(sliceId: string): Promise<void> {
    this.requireSlice(sliceId);
    await this.record(sliceId, "selection", sliceId, { activeSliceId: sliceId });
  }

  public async navigate(direction: "next" | "previous"): Promise<ReviewSlice | undefined> {
    const current = this.project.activeSliceId ? this.index.get(this.project.activeSliceId) : undefined;
    const position = current === undefined ? (direction === "next" ? 0 : this.project.slices.length - 1) : current + (direction === "next" ? 1 : -1);
    const target = this.project.slices[position];
    if (target) await this.select(target.id);
    return target;
  }

  public async decide(sliceId: string, state: Exclude<ReviewState, "skipped">): Promise<void> {
    this.requireSlice(sliceId);
    const reviewedAt = this.clock.now();
    await this.replaceSlice(sliceId, { reviewState: state, reviewedAt, skipReason: undefined }, "decision", state);
  }

  public async skip(sliceId: string, reason: string): Promise<void> {
    this.requireSlice(sliceId);
    const skipReason = reason.trim();
    if (!skipReason) throw new Error("A skipped slice needs a reason.");
    await this.replaceSlice(sliceId, { reviewState: "skipped", reviewedAt: this.clock.now(), skipReason }, "decision", "skipped");
  }

  public async addNote(sliceId: string, note: string): Promise<void> {
    const slice = this.requireSlice(sliceId);
    const value = note.trim();
    if (!value) throw new Error("A note cannot be empty.");
    await this.replaceSlice(sliceId, { notes: [...slice.notes, value] }, "note", value);
  }

  private slice(sliceId: string): ReviewSlice | undefined {
    const position = this.index.get(sliceId);
    return position === undefined ? undefined : this.project.slices[position];
  }

  private requireSlice(sliceId: string): ReviewSlice {
    const slice = this.slice(sliceId);
    if (!slice) throw new Error(`Unknown slice: ${sliceId}`);
    return slice;
  }

  private async replaceSlice(
    sliceId: string,
    change: Partial<ReviewSlice>,
    action: "decision" | "note",
    value: string,
  ): Promise<void> {
    const position = this.index.get(sliceId)!;
    const slices = [...this.project.slices];
    slices[position] = { ...slices[position], ...change };
    await this.record(sliceId, action, value, { slices });
  }

  private async record(
    sliceId: string,
    action: "decision" | "note" | "selection" | "recovery",
    value: string,
    change: Partial<ReviewProject> = {},
  ): Promise<void> {
    const occurredAt = this.clock.now();
    const next: ReviewProject = {
      ...this.project,
      ...change,
      updatedAt: occurredAt,
      history: [...this.project.history, { id: this.identifiers.next(), sliceId, action, value, occurredAt }],
    };
    await this.persistence.save(next);
    this.project = next;
  }
}

function assertValidSlices(slices: readonly ReviewSlice[]): void {
  const ids = new Set<string>();
  for (const slice of slices) {
    if (!slice.id || ids.has(slice.id)) throw new Error("Each slice needs one unique identifier.");
    ids.add(slice.id);
  }
}
