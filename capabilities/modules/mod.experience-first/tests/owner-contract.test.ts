import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactProcessing } from "../../mod.artifact-processing/src/contracts.ts";
import { icon, pageHeading } from "../src/dom.ts";
import { createUserWorkspaceServices, type CreateUserWorkspaceServicesOptions } from "../src/provider-services.ts";
import { mountUserWorkspace } from "../src/UserWorkspaceApp.ts";

test("page heading emits one visible title and a concise summary", () => {
  const markup = pageHeading({
    id: "findings-title",
    eyebrow: "Review evidence",
    title: "Findings",
    summary: "Resolve source-linked concerns.",
  });

  assert.equal((markup.match(new RegExp("<" + "h1", "g")) ?? []).length, 1);
  assert.match(markup, /data-page-title/);
  assert.match(markup, /data-page-summary/);
});

test("icons use the Lucide contract and accessible labels", () => {
  const markup = icon("circle-help", "Help");
  assert.match(markup, /data-lucide="circle-help"/);
  assert.match(markup, /stroke-width="2"/);
  assert.match(markup, /aria-label="Help"/);
});

test("renderer service composition requires an injected artifact boundary", () => {
  const artifact = {} as ArtifactProcessing;
  const options: CreateUserWorkspaceServicesOptions = { artifact };
  assert.equal(options.artifact, artifact);
});

test("dialog Save persists a source-linked finding after reload", async () => {
  const elementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Element");
  const formDataDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  Object.defineProperty(globalThis, "Element", { configurable: true, writable: true, value: TestElement });
  Object.defineProperty(globalThis, "FormData", { configurable: true, writable: true, value: TestFormData });

  const storage = new MemoryStorage();
  const artifact = {} as ArtifactProcessing;
  const root = new TestRoot();
  let workspace: ReturnType<typeof mountUserWorkspace> | undefined;
  const description = "The source limit lacks a required unit.";

  try {
    const services = await createUserWorkspaceServices({ artifact, storage, seedDemo: true });
    workspace = mountUserWorkspace(root as unknown as HTMLElement, {
      services,
      storage,
      initialPage: "review",
    });

    root.dispatch("click", new TestElement({ action: "add-finding" }));
    assert.match(root.innerHTML, /data-dialog-kind="finding"/);
    assert.match(root.innerHTML, /data-action="dialog-surface"/);
    assert.equal((root.innerHTML.match(/data-action="dismiss-dialog"/g) ?? []).length, 3);
    assert.doesNotMatch(root.innerHTML, /\son[a-z]+\s*=/i);

    const dialogSurface = new TestElement({ action: "dialog-surface" });
    root.dispatch("click", new TestElement({}, dialogSurface));
    assert.match(root.innerHTML, /data-dialog-kind="finding"/);

    root.dispatch("click", new TestElement({ action: "dismiss-dialog" }));
    assert.doesNotMatch(root.innerHTML, /data-dialog-kind="finding"/);

    root.dispatch("click", new TestElement({ action: "add-finding" }));
    const saveButton = new TestElement({}, new TestElement({ action: "dialog-surface" }));
    root.dispatch("click", saveButton);
    assert.match(root.innerHTML, /data-dialog-kind="finding"/);
    root.dispatch("submit", new TestFormElement({ type: "Defect", severity: "Major", value: description }));

    await waitFor(() => {
      const saved = storage.getItem("review-slice.findings.v1")?.includes(description) === true;
      return saved && !root.innerHTML.includes('data-dialog-kind="finding"');
    });
    workspace.open("findings");
    assert.match(root.innerHTML, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const reloaded = await createUserWorkspaceServices({ artifact, storage, seedDemo: true });
    const finding = reloaded.findings.list().find((item) => item.description === description);
    assert.ok(finding);
    assert.equal(finding.type, "Defect");
    assert.equal(finding.severity, "Major");
    assert.ok(finding.source.sliceId);
    assert.ok(finding.source.path);
  } finally {
    workspace?.destroy();
    restoreGlobal("Element", elementDescriptor);
    restoreGlobal("FormData", formDataDescriptor);
  }
});

test("production service composition starts empty and recovers findings from its backup", async () => {
  const storage = new MemoryStorage();
  const artifact = {} as ArtifactProcessing;
  const services = await createUserWorkspaceServices({ artifact, storage });
  assert.deepEqual(services.workflow.listProjects(), []);
  assert.deepEqual(services.findings.list(), []);

  const seeded = await createUserWorkspaceServices({ artifact, storage, seedDemo: true });
  assert.ok(seeded.findings.list().length > 0);
  storage.setItem("review-slice.findings.v1", "{not-json");
  const recovered = await createUserWorkspaceServices({ artifact, storage });
  assert.equal(recovered.findings.list().length, seeded.findings.list().length);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number { return this.values.size; }
  public clear(): void { this.values.clear(); }
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  public removeItem(key: string): void { this.values.delete(key); }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

type TestListener = (event: Event) => void;

class TestRoot {
  public innerHTML = "";
  public readonly ownerDocument = {
    defaultView: {
      location: { href: "http://localhost/?page=review", search: "?page=review" },
      history: { replaceState: () => undefined },
    },
    documentElement: { dataset: {} as DOMStringMap },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  private readonly listeners = new Map<string, TestListener>();

  public setAttribute(): void {}
  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") this.listeners.set(type, listener as TestListener);
  }
  public removeEventListener(type: string): void { this.listeners.delete(type); }
  public replaceChildren(): void { this.innerHTML = ""; }
  public querySelector(): null { return null; }
  public dispatch(type: string, target: TestElement): void {
    this.listeners.get(type)?.({ target, preventDefault: () => undefined } as unknown as Event);
  }
}

class TestElement {
  public constructor(
    public readonly dataset: Record<string, string> = {},
    private readonly nearest: TestElement | null = null,
  ) {}

  public closest<T extends Element>(): T | null {
    return (this.nearest ?? this) as unknown as T;
  }
}

class TestFormElement extends TestElement {
  public constructor(public readonly values: Readonly<Record<string, string>>) { super(); }
}

class TestFormData {
  private readonly values: Readonly<Record<string, string>>;
  public constructor(form: TestFormElement) { this.values = form.values; }
  public get(name: string): FormDataEntryValue | null { return this.values[name] ?? null; }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("The dialog Save operation did not persist the finding.");
}

function restoreGlobal(name: "Element" | "FormData", descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
