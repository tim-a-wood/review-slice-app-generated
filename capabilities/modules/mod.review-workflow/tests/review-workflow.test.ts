import { Clock, IdentifierSource, ProjectStore, ReviewProject, ReviewSlice } from "../src/contracts";
import { PersistenceCoordinator } from "../src/persistence";
import { ReviewWorkflow } from "../src/review-workflow";

class Store implements ProjectStore {
  public primary = new Map<string, ReviewProject>();
  public backup = new Map<string, ReviewProject>();
  public primaryWrites = 0;
  public backupWrites = 0;
  public async loadPrimary(id: string): Promise<ReviewProject | undefined> { return this.primary.get(id); }
  public async loadBackup(id: string): Promise<ReviewProject | undefined> { return this.backup.get(id); }
  public async savePrimary(project: ReviewProject): Promise<void> { this.primaryWrites++; this.primary.set(project.id, project); }
  public async saveBackup(project: ReviewProject): Promise<void> { this.backupWrites++; this.backup.set(project.id, project); }
}

class TestClock implements Clock {
  private value = 0;
  public now(): string { return `2026-08-01T00:00:${String(this.value++).padStart(2, "0")}Z`; }
}

class TestIdentifiers implements IdentifierSource {
  private value = 0;
  public next(): string { return `history-${++this.value}`; }
}

function slice(sequence: number): ReviewSlice {
  return {
    id: `slice-${sequence}`,
    matchKey: `key-${sequence}`,
    title: `Slice ${sequence}`,
    sequence,
    source: { artifactId: "artifact-1", path: "C:\\review\\input.md", location: `line ${sequence}` },
    revisionState: "unchanged",
    contentHash: `hash-${sequence}`,
    reviewState: "not-reviewed",
    notes: [],
  };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runReviewWorkflowTests(): Promise<void> {
  const store = new Store();
  const clock = new TestClock();
  const identifiers = new TestIdentifiers();
  const persistence = new PersistenceCoordinator(store);
  const slices = Array.from({ length: 5000 }, (_, index) => slice(5000 - index));
  const workflow = await ReviewWorkflow.create({ id: "project-1", name: "Review", slices }, persistence, clock, identifiers);

  check(workflow.snapshot().slices[0].id === "slice-1", "The workflow must order navigation by sequence.");
  await workflow.navigate("next");
  check(workflow.activeSlice()?.id === "slice-1", "Next must select the first slice.");
  await workflow.decide("slice-1", "accepted");
  await workflow.addNote("slice-1", "  Checked source link.  ");
  const first = workflow.activeSlice()!;
  check(first.reviewState === "accepted" && first.notes[0] === "Checked source link.", "The workflow must save decisions and notes.");
  check(store.primaryWrites === store.backupWrites && store.primaryWrites >= 4, "Each change must save the primary and backup stores.");

  let rejected = false;
  try { await workflow.skip("slice-2", " "); } catch { rejected = true; }
  check(rejected, "Skip must require a reason.");
  await workflow.skip("slice-2", "Outside review scope");
  check(workflow.snapshot().slices[1].skipReason === "Outside review scope", "Skip must retain its reason.");

  store.primary.clear();
  const resumed = await ReviewWorkflow.resume("project-1", persistence, clock, identifiers);
  check(resumed?.activeSlice()?.source.path === "C:\\review\\input.md", "Recovery must preserve exact source links.");
  check(resumed?.snapshot().history.at(-1)?.action === "recovery", "Recovery must record its event.");
}
