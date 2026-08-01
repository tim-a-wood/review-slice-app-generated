import assert from "node:assert/strict";
import test from "node:test";
import { FindingsStore } from "../src/findings-store.ts";
import type {
  Finding,
  FindingsPersistence,
  SourceLocation,
} from "../src/contracts.ts";

const source: SourceLocation = {
  artifactId: "artifact-1",
  path: "C:\\reviews\\spec.md",
  sliceId: "slice-7",
  location: "Section 3.2, lines 40-48",
  title: "Power limits",
};

const createStore = () => {
  let saved: Finding[] = [];
  let opened: SourceLocation | undefined;
  const persistence: FindingsPersistence = {
    load: async () => saved,
    save: async (findings) => { saved = JSON.parse(JSON.stringify(findings)); },
  };
  const store = new FindingsStore(
    persistence,
    { openSource: (value) => { opened = value; } },
    (() => { let value = 0; return () => `2026-08-01T00:00:0${++value}.000Z`; })(),
    (() => { let value = 0; return () => `FND-${++value}`; })(),
  );
  return { store, readSaved: () => saved, readOpened: () => opened };
};

test("creates a source-linked finding and saves it", async () => {
  const { store, readSaved } = createStore();
  const finding = await store.create({
    type: "Defect",
    description: "The limit has no unit.",
    source,
    severity: "Major",
  });

  assert.equal(finding.status, "Open");
  assert.equal(finding.history.length, 1);
  assert.equal(readSaved()[0].source.location, source.location);
});

test("preserves history during lifecycle updates", async () => {
  const { store } = createStore();
  const finding = await store.create({ type: "Question", description: "Is the value nominal?", source });
  await store.update(finding.id, { resolutionNote: "Use the approved limit." });
  await store.setStatus(finding.id, "Addressed", "The author updated the document.");
  const verified = await store.verify(finding.id, "revision-2", "I verified the change.");

  assert.equal(verified.status, "Verified");
  assert.equal(verified.verifiedRevisionId, "revision-2");
  assert.deepEqual(verified.history.map((item) => item.action), ["Created", "Updated", "Status changed", "Verified"]);
});

test("filters findings and reopens the linked source", async () => {
  const { store, readOpened } = createStore();
  const finding = await store.create({ type: "Improvement", description: "Clarify power terminology.", source });

  assert.equal(store.list({ query: "power", type: "Improvement", sliceId: "slice-7" }).length, 1);
  await store.openSource(finding.id);
  assert.equal(readOpened()?.path, source.path);
});
