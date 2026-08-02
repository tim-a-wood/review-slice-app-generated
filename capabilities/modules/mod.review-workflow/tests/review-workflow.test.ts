import assert from "node:assert/strict";
import test from "node:test";
import { createReviewWorkflow } from "../src/index.ts";
import type {
  PersistedWorkflowEnvelope,
  WorkflowClock,
  WorkflowIdentifierSource,
  WorkflowPersistencePort,
} from "../src/index.ts";

class MemoryPersistence implements WorkflowPersistencePort {
  public primary?: PersistedWorkflowEnvelope;
  public backup?: PersistedWorkflowEnvelope;
  public primaryWrites = 0;
  public backupWrites = 0;
  public loadPrimary = async () => this.primary;
  public loadBackup = async () => this.backup;
  public savePrimary = async (value: PersistedWorkflowEnvelope) => { this.primaryWrites += 1; this.primary = structuredClone(value); };
  public saveBackup = async (value: PersistedWorkflowEnvelope) => { this.backupWrites += 1; this.backup = structuredClone(value); };
}

const deterministicPorts = () => {
  let tick = 0;
  let identifier = 0;
  const clock: WorkflowClock = { now: () => `2026-08-01T00:00:${String(tick++).padStart(2, "0")}.000Z` };
  const identifiers: WorkflowIdentifierSource = { next: (kind) => `${kind}-${++identifier}` };
  return { clock, identifiers };
};

const revision = (id: string, changed = false) => ({
  id,
  label: id,
  fileName: "spec.md",
  fileHash: `file-${id}`,
  artifactType: "markdown",
  parserVersion: "1.0.0",
  slices: [
    { id: `${id}-2`, stableMatchKey: "section-b", title: "Limits", content: changed ? "Changed" : "Original", contentHash: changed ? "changed" : "same-b", sequence: 2, revisionState: changed ? "modified" as const : "added" as const, source: { artifactId: id, path: "C:\\reviews\\spec.md", location: "Section 2" } },
    { id: `${id}-1`, stableMatchKey: "section-a", title: "Scope", content: "Stable", contentHash: "same-a", sequence: 1, revisionState: changed ? "unchanged" as const : "added" as const, source: { artifactId: id, path: "C:\\reviews\\spec.md", location: "Section 1" } },
  ],
});

test("manages multiple projects, revisions, decisions, filtering, and queued autosave", async () => {
  const persistence = new MemoryPersistence();
  const ports = deterministicPorts();
  const workflow = await createReviewWorkflow({ persistence, ...ports });
  const first = await workflow.createProject({ id: "project-b", name: "Second", initialRevision: revision("r1") });
  await workflow.createProject({ id: "project-a", name: "First" });
  await workflow.renameProject("project-a", "First renamed");
  await workflow.setProjectArchived("project-a", true);
  assert.equal(workflow.activeProject(), undefined, "archiving the active project clears the active selection");
  await workflow.setProjectArchived("project-a", false);
  await workflow.openProject(first.id);

  await workflow.decide(first.id, "r1-1", "accepted", "Source checked.");
  await workflow.skip(first.id, "r1-2", "Outside the approved scope");
  await workflow.addNote(first.id, "r1-1", "Requirement identifier is traceable.");
  const next = await workflow.addRevision(first.id, revision("r2", true));

  assert.equal(next.slices[0].id, "r2-1", "slices are ordered deterministically");
  assert.equal(next.slices[0].reviewState, "accepted", "unchanged decisions are inherited");
  assert.equal(next.slices[1].reviewState, "re-review-required", "modified slices return to the queue");
  assert.equal(workflow.activeSlice(first.id)?.id, "r2-2");
  assert.equal(workflow.listSlices(first.id, { reviewStates: ["re-review-required"] })[0].id, "r2-2");
  await workflow.selectSlice(first.id, "r2-1");
  assert.equal((await workflow.navigate(first.id, "next", { revisionStates: ["modified"] }))?.id, "r2-2");
  assert.equal(await workflow.navigate(first.id, "next", { revisionStates: ["modified"] }), undefined);
  assert.equal(persistence.primaryWrites, persistence.backupWrites);
  assert.ok(persistence.primaryWrites >= 10, "every mutation is saved immediately");
  assert.deepEqual(workflow.snapshot().projects.map((project) => project.id), ["project-a", "project-b"]);
});

test("inherits a disposition through an explicit reviewer-confirmed mapping", async () => {
  const workflow = await createReviewWorkflow({ persistence: new MemoryPersistence(), ...deterministicPorts() });
  const project = await workflow.createProject({ id: "mapped", name: "Mapped review", initialRevision: revision("r1") });
  await workflow.decide(project.id, "r1-1", "accepted");

  const mappedRevision = revision("r2");
  const mappedScope = {
    ...mappedRevision.slices[1],
    id: "r2-renamed-scope",
    stableMatchKey: "renamed-section-a",
    revisionState: "relocated" as const,
    previousSliceId: "r1-1",
  };
  const next = await workflow.addRevision(project.id, {
    ...mappedRevision,
    slices: [mappedRevision.slices[0], mappedScope],
  });

  const carried = next.slices.find((slice) => slice.id === mappedScope.id);
  assert.equal(carried?.reviewState, "accepted");
  assert.equal(carried?.previousSliceId, "r1-1");
  assert.equal(carried?.previousReviewState, "accepted");
});

test("requires skip reasons and recovers the newest valid backup with metadata", async () => {
  const persistence = new MemoryPersistence();
  const ports = deterministicPorts();
  const workflow = await createReviewWorkflow({ persistence, ...ports });
  await workflow.createProject({ id: "project-1", name: "Review", initialRevision: revision("r1") });
  await assert.rejects(workflow.skip("project-1", "r1-1", " "), /needs a reason/);
  persistence.primary = undefined;

  const resumed = await createReviewWorkflow({ persistence, ...deterministicPorts() });
  assert.equal(resumed.getProject("project-1")?.revisions[0].slices[0].source.path, "C:\\reviews\\spec.md");
  assert.equal(resumed.recoveryMetadata().source, "backup");
  assert.equal(resumed.recoveryMetadata().recovered, true);
});

test("deletes only the selected project and preserves the other project state", async () => {
  const workflow = await createReviewWorkflow({ persistence: new MemoryPersistence(), ...deterministicPorts() });
  await workflow.createProject({ id: "keep", name: "Keep" });
  await workflow.createProject({ id: "delete", name: "Delete" });
  await workflow.deleteProject("delete");
  assert.deepEqual(workflow.snapshot().projects.map((project) => project.id), ["keep"]);
});
