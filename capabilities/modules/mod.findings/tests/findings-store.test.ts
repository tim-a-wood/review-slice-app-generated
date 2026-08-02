import assert from "node:assert/strict";
import test from "node:test";
import { createFindingsManagement } from "../src/index.ts";
import type {
  FindingsIdentifierSource,
  FindingsSnapshot,
  SourceLocation,
} from "../src/index.ts";

const source = (revisionId = "revision-1", sliceId = "slice-7"): SourceLocation => ({
  projectId: "project-1",
  revisionId,
  artifactId: `artifact-${revisionId}`,
  sliceId,
  path: "C:\\reviews\\spec.md",
  location: "Section 3.2, lines 40-48",
  title: "Power limits",
  startLine: 40,
  endLine: 48,
});

const createHarness = async () => {
  let saved: FindingsSnapshot | undefined;
  let opened: SourceLocation | undefined;
  let tick = 0;
  let sequence = 0;
  const identifiers: FindingsIdentifierSource = { next: (kind) => kind === "finding" ? `FND-${++sequence}` : `${kind}-${++sequence}` };
  const management = await createFindingsManagement({
    persistence: {
      load: async () => saved,
      save: async (snapshot) => { saved = structuredClone(snapshot); },
    },
    navigator: { openSource: (value) => { opened = value; } },
    clock: { now: () => `2026-08-01T00:00:0${tick++}.000Z` },
    identifiers,
  });
  return { management, saved: () => saved, opened: () => opened };
};

test("creates, edits, filters, and reopens an exact source-linked finding", async () => {
  const harness = await createHarness();
  const finding = await harness.management.create({
    type: "Defect",
    description: "The limit has no unit.",
    source: source(),
    severity: "Major",
    externalReference: "SYS-41",
  });
  const edited = await harness.management.edit(finding.id, {
    type: "Traceability issue",
    resolution: "Add the approved unit and trace reference.",
  });

  assert.equal(edited.resolution, "Add the approved unit and trace reference.");
  assert.equal(harness.management.list({ query: "Power", severity: "Major", sliceId: "slice-7" }).length, 1);
  await harness.management.openSource(finding.id);
  assert.deepEqual(harness.opened(), source());
  assert.equal(harness.saved()?.generation, 2);
});

test("records evidence, lifecycle transitions, and later-revision verification", async () => {
  const { management } = await createHarness();
  const finding = await management.create({ type: "Question", description: "Is the value nominal?", source: source() });
  await management.addEvidence(finding.id, {
    id: "evidence-1",
    name: "updated-section.txt",
    path: "C:\\reviews\\evidence\\updated-section.txt",
    mediaType: "text/plain",
    contentHash: "evidence-hash",
    sizeBytes: 42,
    addedAt: "2026-08-01T00:01:00.000Z",
  });
  await management.transitionStatus(finding.id, "Addressed", "The author supplied the unit.");
  const verified = await management.verifyAgainstRevision(finding.id, source("revision-2", "slice-9"), "Checked the revised source.");

  assert.equal(verified.status, "Verified");
  assert.equal(verified.verifications[0].revisionId, "revision-2");
  assert.equal(verified.verifications[0].source.sliceId, "slice-9");
  assert.deepEqual(verified.history.map((entry) => entry.action), ["Created", "Evidence added", "Status changed", "Verified"]);
});

test("enforces lifecycle and relationship integrity", async () => {
  const { management } = await createHarness();
  const first = await management.create({ type: "Defect", description: "First", source: source() });
  await assert.rejects(management.verifyAgainstRevision(first.id, source("revision-2")), /must be Addressed/);
  await assert.rejects(management.edit(first.id, { relatedFindingId: first.id }), /cannot relate to itself/);
  const second = await management.create({ type: "Improvement", description: "Second", source: source("revision-1", "slice-8"), relatedFindingId: first.id });
  assert.equal(second.relatedFindingId, first.id);
});

test("deletes only findings linked to the selected project", async () => {
  const { management: findings } = await createHarness();
  await findings.create({ id: "FND-A", type: "Defect", description: "A", source: source("revision-1", "slice-a") });
  await findings.create({ id: "FND-B", type: "Question", description: "B", source: { ...source("revision-1", "slice-b"), projectId: "project-b" } });

  assert.equal(await findings.deleteForProject("project-1"), 1);
  assert.deepEqual(findings.list().map((finding) => finding.id), ["FND-B"]);
});
