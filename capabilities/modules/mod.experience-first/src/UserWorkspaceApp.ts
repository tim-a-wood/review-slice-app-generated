import type { ArtifactSlice, SlicingOptions } from "../../mod.artifact-processing/src/contracts.ts";
import type { EvidenceExportData, EvidenceExportResult, FindingRecord, ReviewState as EvidenceReviewState, RevisionState as EvidenceRevisionState, SliceRecord } from "../../mod.evidence-export/src/contracts.ts";
import type { FindingStatus, FindingType } from "../../mod.findings/src/contracts.ts";
import type { ArtifactRevisionInput, ReviewProject, ReviewSlice } from "../../mod.review-workflow/src/contracts.ts";
import type { ImportDraft, UserWorkspace, UserWorkspaceMountOptions, WorkspaceDialog, WorkspacePage, WorkspaceView } from "./contracts.ts";
import { renderDashboard, renderImport } from "./dashboard-import.ts";
import { downloadInDocument } from "./dom.ts";
import { renderEvidence, renderFindings } from "./findings-exports.ts";
import { renderReview } from "./review.ts";
import { renderMappings, renderRevisions } from "./revisions.ts";
import { renderShell, type ColorMode } from "./shell.ts";
import { metrics, projectProgress, reviewUnitSliceIds } from "./view-model.ts";

export const PRESENTATION_OWNER_MARKER = 'data-presentation-owner="mod.experience-first"';
export const REQUIRED_OPERATION_IDS = Object.freeze([
  "compare-artifact-revisions", "configure-artifact-slices", "correct-revision-mappings",
  "create-review-project", "export-review-evidence", "manage-finding-lifecycle",
  "record-source-linked-findings", "resume-review-session", "review-document-slices",
]);

export function mountUserWorkspace(root: HTMLElement, options: UserWorkspaceMountOptions): UserWorkspace {
  root.setAttribute("data-presentation-owner", "mod.experience-first");
  root.setAttribute("data-standards-source", "engineering-ui-kit-standards");
  const application = new UserWorkspaceController(root, options);
  application.start();
  return {
    open: (page) => application.open(page),
    refresh: () => application.render(),
    destroy: () => application.destroy(),
  };
}

class UserWorkspaceController {
  private page: WorkspacePage;
  private status: WorkspaceView["status"] = "ready";
  private draft: ImportDraft = freshDraft("new-project");
  private comparison: WorkspaceView["comparison"];
  private filter = "all";
  private query = "";
  private findingQuery = "";
  private findingStatus: WorkspaceView["findingStatus"] = "all";
  private showDiff = false;
  private collapsed = false;
  private colorMode: ColorMode = "system";
  private readonly modeStorage?: Storage;
  private savedAt?: string;
  private notice?: string;
  private error?: string;
  private exportResult?: EvidenceExportResult;
  private dialog?: WorkspaceDialog;
  private readonly click = (event: Event): void => this.onClick(event);
  private readonly change = (event: Event): void => this.onChange(event);
  private readonly input = (event: Event): void => this.onInput(event);
  private readonly submit = (event: Event): void => this.onSubmit(event);
  private readonly keydown = (event: KeyboardEvent): void => this.onKeydown(event);

  public constructor(private readonly root: HTMLElement, private readonly options: UserWorkspaceMountOptions) {
    const window = root.ownerDocument.defaultView;
    const requested = new URLSearchParams(window?.location.search ?? "").get("page") as WorkspacePage | null;
    this.page = requested && ["dashboard", "import", "review", "revisions", "mappings", "findings", "evidence"].includes(requested) ? requested : options.initialPage ?? "dashboard";
    this.modeStorage = options.storage ?? window?.localStorage;
    const savedTheme = this.modeStorage?.getItem("review-slice.color-mode");
    this.colorMode = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
    this.applyColorMode();
  }

  public start(): void {
    this.root.addEventListener("click", this.click);
    this.root.addEventListener("change", this.change);
    this.root.addEventListener("input", this.input);
    this.root.addEventListener("submit", this.submit);
    this.root.ownerDocument.addEventListener("keydown", this.keydown);
    this.render();
  }

  public destroy(): void {
    this.root.removeEventListener("click", this.click);
    this.root.removeEventListener("change", this.change);
    this.root.removeEventListener("input", this.input);
    this.root.removeEventListener("submit", this.submit);
    this.root.ownerDocument.removeEventListener("keydown", this.keydown);
    this.root.replaceChildren();
  }

  public open(page: WorkspacePage): void {
    this.page = page;
    const window = this.root.ownerDocument.defaultView;
    if (window) { const url = new URL(window.location.href); url.searchParams.set("page", page); window.history.replaceState({}, "", url); }
    this.render();
    this.root.querySelector<HTMLElement>(".page-canvas")?.focus();
  }

  public render(): void {
    const view = this.view();
    const content = view.page === "dashboard" ? renderDashboard(view)
      : view.page === "import" ? renderImport(view)
        : view.page === "review" ? renderReview(view)
          : view.page === "revisions" ? renderRevisions(view)
            : view.page === "mappings" ? renderMappings(view)
              : view.page === "findings" ? renderFindings(view)
                : renderEvidence(view);
    this.root.innerHTML = renderShell(view, content, this.collapsed, this.colorMode);
  }

  private view(): WorkspaceView {
    const { workflow, findings } = this.options.services;
    const projects = workflow.listProjects();
    const allProjects = workflow.listProjects({ includeArchived: true });
    const allFindings = findings.list();
    const project = workflow.activeProject() ?? projects[0];
    const revision = project?.revisions.find((item) => item.id === project.activeRevisionId) ?? project?.revisions.at(-1);
    const revisionIndex = project?.revisions.findIndex((item) => item.id === revision?.id) ?? -1;
    const previousRevision = revisionIndex > 0 ? project?.revisions[revisionIndex - 1] : undefined;
    const slices = revision?.slices ?? [];
    const activeSlice = slices.find((slice) => slice.id === project?.activeSliceId) ?? slices.find((slice) => slice.revisionState !== "removed") ?? slices[0];
    const previousSlice = activeSlice
      ? activeSlice.previousSliceId
        ? previousRevision?.slices.find((slice) => slice.id === activeSlice.previousSliceId)
        : previousRevision?.slices.find((slice) => slice.stableMatchKey === activeSlice.stableMatchKey)
      : undefined;
    const projectFindings = project ? allFindings.filter((finding) => finding.source.projectId === project.id) : [];
    return {
      page: this.page,
      status: this.status,
      projects: allProjects.map((item) => { const progress = projectProgress(item, allFindings); return { project: item, completionPercent: progress.completionPercent, remaining: progress.remaining, openFindings: progress.openFindings, reReview: progress.reReview }; }),
      project,
      revisionLabel: revision?.label,
      previousRevisionLabel: previousRevision?.label,
      slices,
      findings: projectFindings,
      importDraft: this.draft,
      comparison: this.comparison,
      activeSlice,
      previousSlice,
      filter: this.filter,
      query: this.query,
      findingQuery: this.findingQuery,
      findingStatus: this.findingStatus,
      showDiff: this.showDiff,
      dataPath: this.options.dataPath ?? "Local application data / Review Slice",
      savedAt: this.savedAt,
      notice: this.notice,
      error: this.error,
      exportResult: this.exportResult,
      dialog: this.dialog,
    };
  }

  private run(operation: () => void | Promise<void>): void {
    this.status = "loading"; this.error = undefined; this.notice = undefined; this.render();
    void Promise.resolve(operation()).then(() => { this.status = "ready"; this.savedAt = new Date().toISOString(); this.render(); }).catch((cause: unknown) => { this.status = "error"; this.error = cause instanceof Error ? cause.message : "The action did not finish."; this.render(); });
  }

  private onClick(event: Event): void {
    const command = (event.target as Element | null)?.closest<HTMLElement>("[data-action], [data-page]");
    if (!command) return;
    const action = command.dataset.action;
    if (command.dataset.page) { this.open(command.dataset.page as WorkspacePage); return; }
    if (action === "toggle-navigation" || action === "collapse-slices") { this.collapsed = !this.collapsed; this.render(); return; }
    if (action === "theme") { this.toggleTheme(); return; }
    if (action === "clear-message") { this.error = undefined; this.notice = undefined; this.status = "ready"; this.render(); return; }
    if (action === "dismiss-dialog") { this.dialog = undefined; this.render(); return; }
    if (action === "start-project") { this.draft = freshDraft("new-project"); this.open("import"); return; }
    if (action === "start-revision") { this.draft = { ...freshDraft("revision"), projectName: this.view().project?.name ?? "" }; this.open("import"); return; }
    if (action === "cancel-import") { this.open("dashboard"); return; }
    if (action === "choose-file") { this.root.querySelector<HTMLInputElement>("#review-slice-file")?.click(); return; }
    if (action === "choose-directory") { this.root.querySelector<HTMLInputElement>("#review-slice-directory")?.click(); return; }
    if (action === "import-back") { this.draft = { ...this.draft, phase: "select" }; this.render(); return; }
    if (action === "preview-back") { this.draft = { ...this.draft, phase: "detect" }; this.render(); return; }
    if (action === "preview-confirm") { this.draft = { ...this.draft, phase: "confirm" }; this.render(); return; }
    if (action === "confirm-back") { this.draft = { ...this.draft, phase: "preview" }; this.render(); return; }
    if (action === "detect-structure" || action === "refresh-preview") { this.run(() => this.previewImport()); return; }
    if (action === "confirm-import") { this.run(() => this.confirmImport()); return; }
    if (action === "open-project") { this.run(async () => { await this.options.services.workflow.openProject(command.dataset.projectId!); this.open("review"); }); return; }
    if (action === "open-review") { this.open("review"); return; }
    if (action === "open-findings" || action === "open-questions") { if (action === "open-questions") this.findingStatus = "Open"; this.open("findings"); return; }
    if (action === "open-evidence") { this.open("evidence"); return; }
    if (action === "open-revisions") { this.open("revisions"); return; }
    if (action === "open-mappings") { this.open("mappings"); return; }
    if (action === "open-changed") { this.filter = "changed"; this.open("review"); return; }
    if (action === "review-revision-state") { this.filter = command.dataset.filter ?? "all"; this.open("review"); return; }
    if (action === "filter-slices") { this.filter = command.dataset.filter ?? "all"; this.render(); return; }
    if (action === "clear-slice-filter") { this.filter = "all"; this.query = ""; this.render(); return; }
    if (action === "clear-finding-filter") { this.findingQuery = ""; this.findingStatus = "all"; this.render(); return; }
    if (action === "filter-finding-status") { this.findingStatus = command.dataset.status as FindingStatus; this.render(); return; }
    if (action === "select-slice") { this.run(async () => { const project = this.requireProject(); await this.options.services.workflow.selectSlice(project.id, command.dataset.sliceId!); if (this.page !== "review") this.open("review"); }); return; }
    if (action === "accept-slice") { this.run(() => this.decide("accepted")); return; }
    if (action === "previous-slice" || action === "next-slice") { this.run(() => this.navigate(action === "next-slice" ? "next" : "previous")); return; }
    if (action === "add-finding" || action === "add-question" || action === "skip-slice" || action === "add-note") { this.openDialog(action); return; }
    if (action === "toggle-diff") { this.showDiff = !this.showDiff; this.render(); return; }
    if (action === "copy-source-link") { this.run(() => this.copySource()); return; }
    if (action === "open-finding" || action === "open-finding-source") { this.run(() => this.openFindingSource(command.dataset.findingId!)); return; }
    if (action === "finding-resolution") { this.dialog = { kind: "resolution", title: "Add resolution note", description: "Record how the concern was resolved.", targetId: command.dataset.findingId! }; this.render(); return; }
    if (action === "edit-finding") {
      const finding = this.options.services.findings.get(command.dataset.findingId!);
      if (!finding) return;
      this.dialog = { kind: "edit-finding", title: `Edit ${finding.id}`, description: "Update the finding while retaining its source link and history.", targetId: finding.id, initialValue: finding.description, findingType: finding.type, findingSeverity: finding.severity };
      this.render();
      return;
    }
    if (action === "build-evidence") { this.run(() => this.buildEvidence()); return; }
    if (action === "download-evidence" || action === "download-findings") { this.run(() => this.download(command.dataset.name ?? (command.dataset.format === "csv" ? "findings.csv" : "findings.json"))); return; }
    if (action === "confirm-mapping") { this.run(() => this.confirmMapping(command.dataset.previousId!, command.dataset.currentId!)); return; }
    if (action === "reject-mapping") { this.rejectMapping(command.dataset.previousId!, command.dataset.currentId!); return; }
    if (action === "finalize-revision-import") { this.run(() => this.finalizeRevisionImport()); return; }
    if (action === "rename-project") {
      const project = this.options.services.workflow.getProject(command.dataset.projectId!);
      if (!project) return;
      this.dialog = { kind: "rename", title: "Rename project", description: "Enter a clear review project name.", targetId: project.id, initialValue: project.name };
      this.render();
      return;
    }
    if (action === "archive-project" || action === "restore-project") {
      const archived = action === "archive-project";
      this.run(async () => {
        await this.options.services.workflow.setProjectArchived(command.dataset.projectId!, archived);
        this.dialog = undefined;
        this.open("dashboard");
      });
      return;
    }
    if (action === "delete-project") {
      const project = this.options.services.workflow.getProject(command.dataset.projectId!);
      if (!project) return;
      this.dialog = { kind: "delete", title: `Delete ${project.name}?`, description: "This removes the project, its review history, and its linked findings from this computer.", targetId: project.id };
      this.render();
      return;
    }
  }

  private onChange(event: Event): void {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    if (control.id === "review-slice-file" || control.id === "review-slice-directory") {
      if (control instanceof HTMLInputElement) this.run(() => this.readFiles(control.files));
      return;
    }
    if (control.dataset.action === "toggle-slice") {
      if (!(control instanceof HTMLInputElement)) return;
      const key = control.dataset.matchKey!;
      const excluded = new Set(this.draft.excludedMatchKeys);
      control.checked ? excluded.delete(key) : excluded.add(key);
      this.draft = { ...this.draft, excludedMatchKeys: [...excluded] };
      return;
    }
    if (control.dataset.action === "finding-status") { this.run(() => this.changeFindingStatus(control.dataset.findingId!, control.value as FindingStatus)); return; }
    if (control.dataset.field === "findingStatus") { this.findingStatus = control.value as WorkspaceView["findingStatus"]; this.render(); return; }
    if (["strategy", "headingDepth", "combineBelowCharacters", "splitAboveCharacters"].includes(control.dataset.field ?? "")) this.updateSlicingField(control);
  }

  private onInput(event: Event): void {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;
    if (control.dataset.field === "sliceQuery") { this.query = control.value; this.render(); }
    else if (control.dataset.field === "findingQuery") { this.findingQuery = control.value; this.render(); }
    else if (control.dataset.field === "projectName") this.draft = { ...this.draft, projectName: control.value };
    else if (control.dataset.field === "revisionLabel") this.draft = { ...this.draft, revisionLabel: control.value };
  }

  private onSubmit(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const form = target.closest<HTMLFormElement>("[data-dialog-form]");
    if (!form || !this.dialog) return;
    event.preventDefault();
    const data = new FormData(form);
    const dialog = this.dialog;
    this.run(async () => {
      const value = String(data.get("value") ?? "").trim();
      if (dialog.kind === "finding" || dialog.kind === "question") await this.createFinding(String(data.get("type")) as FindingType, String(data.get("severity")) as "Critical" | "Major" | "Minor" | "Info", value);
      else if (dialog.kind === "edit-finding") await this.options.services.findings.edit(dialog.targetId, { type: String(data.get("type")) as FindingType, severity: String(data.get("severity")) as "Critical" | "Major" | "Minor" | "Info", description: value });
      else if (dialog.kind === "skip") await this.skip(value);
      else if (dialog.kind === "note") await this.addNote(value);
      else if (dialog.kind === "rename") await this.options.services.workflow.renameProject(dialog.targetId, value);
      else if (dialog.kind === "delete") {
        await this.options.services.findings.deleteForProject(dialog.targetId);
        await this.options.services.workflow.deleteProject(dialog.targetId);
        this.open("dashboard");
      }
      else if (dialog.kind === "resolution") await this.options.services.findings.edit(dialog.targetId, { resolution: value });
      this.dialog = undefined;
    });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (this.page !== "review" || event.altKey || event.ctrlKey || event.metaKey || this.dialog || isEditing(event.target)) return;
    const key = event.key.toLocaleLowerCase();
    if (!["a", "f", "q", "s", "j", "k"].includes(key)) return;
    event.preventDefault();
    if (key === "a") this.run(() => this.decide("accepted"));
    else if (key === "j" || key === "k") this.run(() => this.navigate(key === "j" ? "next" : "previous"));
    else this.openDialog(key === "f" ? "add-finding" : key === "q" ? "add-question" : "skip-slice");
  }

  private async readFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const sources = await Promise.all([...files].map(async (file) => ({ displayName: file.name, relativePath: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const extension = sources[0]?.relativePath.split(".").at(-1)?.toLocaleLowerCase();
    const kindByExtension = { md: "markdown", markdown: "markdown", txt: "text", docx: "docx", pdf: "pdf", csv: "csv", json: "json", xml: "xml", diff: "diff", patch: "diff" } as const;
    const detectedKind = extension && extension in kindByExtension ? kindByExtension[extension as keyof typeof kindByExtension] : sources.length > 1 ? "source-directory" : "text";
    const displayName = sources.length > 1 ? sources[0].relativePath.split("/")[0] || "Source directory" : sources[0].displayName;
    this.draft = { ...this.draft, phase: "detect", sources, detectedKind, projectName: this.draft.mode === "new-project" ? displayName.replace(/\.[^.]+$/, "") : this.draft.projectName, revisionLabel: this.draft.mode === "revision" ? `Revision ${this.requireProject().revisions.length + 1}` : "Revision A" };
  }

  private async previewImport(): Promise<void> {
    if (!this.draft.sources.length) throw new Error("Select a source before structure detection.");
    const options: SlicingOptions = { ...this.draft.options, excludedMatchKeys: this.draft.excludedMatchKeys };
    const result = await this.options.services.artifact.importArtifact({ displayName: this.draft.sources[0].displayName, source: this.draft.sources, kind: this.draft.detectedKind }, options);
    if (!result.ok) throw result.error;
    this.draft = { ...this.draft, phase: "preview", result: result.value, warnings: result.diagnostics, options: result.value.slicing, busy: false };
  }

  private async confirmImport(): Promise<void> {
    const result = this.draft.result;
    if (!result) throw new Error("Preview the slices before confirmation.");
    if (!this.draft.projectName.trim() || !this.draft.revisionLabel.trim()) throw new Error("Enter a project name and revision label.");
    const workflow = this.options.services.workflow;
    if (this.draft.mode === "new-project") {
      await workflow.createProject({ name: this.draft.projectName, description: `Review of ${result.artifact.displayName}`, initialRevision: revisionInput(result.artifact.id, result.artifact.displayName, result.artifact.sourceHash, result.artifact.kind, this.draft.revisionLabel, result.slices) });
      this.notice = `Created ${result.slices.length} source-linked review slices.`;
      this.draft = freshDraft("new-project");
      this.open("review");
    } else {
      const project = this.requireProject();
      const previousRevision = project.revisions.find((item) => item.id === project.activeRevisionId) ?? project.revisions.at(-1);
      if (!previousRevision) throw new Error("The active project has no prior revision.");
      const prior = previousRevision.slices
        .filter((slice) => slice.revisionState !== "removed")
        .map(toArtifactSlice);
      const compared = await this.options.services.artifact.compareRevisions(prior, result.slices, { yieldEvery: 100 });
      if (!compared.ok) throw compared.error;
      this.comparison = { previousLabel: previousRevision.label, currentLabel: this.draft.revisionLabel, comparison: compared.value, confirmedMappings: [], rejectedCandidateKeys: [], importedAt: new Date().toISOString() };
      if (compared.value.uncertainCandidates.length) {
        this.notice = `${compared.value.uncertainCandidates.length} uncertain mappings require review before the revision is added.`;
        this.open("mappings");
      } else {
        await this.finalizeRevisionImport();
      }
    }
  }

  private updateSlicingField(control: HTMLInputElement | HTMLSelectElement): void {
    const field = control.dataset.field!;
    const value = field === "strategy" ? control.value : Number(control.value);
    this.draft = { ...this.draft, options: { ...this.draft.options, [field]: value } };
  }

  private async decide(state: "accepted" | "finding" | "question" | "re-review-required" | "not-reviewed"): Promise<void> { const view = this.view(); if (!view.activeSlice || !view.project) return; await this.options.services.workflow.decide(view.project.id, view.activeSlice.id, state); }
  private async skip(reason: string): Promise<void> { if (!reason) throw new Error("Enter a skip reason."); const view = this.view(); if (view.project && view.activeSlice) await this.options.services.workflow.skip(view.project.id, view.activeSlice.id, reason); }
  private async addNote(note: string): Promise<void> { if (!note) throw new Error("Enter a review note."); const view = this.view(); if (view.project && view.activeSlice) await this.options.services.workflow.addNote(view.project.id, view.activeSlice.id, note); }
  private async navigate(direction: "next" | "previous"): Promise<void> { const project = this.requireProject(); await this.options.services.workflow.navigate(project.id, direction, this.filter === "all" ? {} : this.filter === "changed" ? { revisionStates: ["modified", "added", "relocated", "unmatched"] } : this.filter.includes("review") || ["finding", "question", "skipped", "not-reviewed"].includes(this.filter) ? { reviewStates: [this.filter as ReviewSlice["reviewState"]] } : { revisionStates: [this.filter as ReviewSlice["revisionState"]] }); }

  private async createFinding(type: FindingType, severity: "Critical" | "Major" | "Minor" | "Info", description: string): Promise<void> {
    if (!description) throw new Error("Enter a finding description.");
    const view = this.view(); const slice = view.activeSlice; const project = view.project;
    if (!slice || !project) throw new Error("Open a source slice first.");
    const revision = project.revisions.find((item) => item.id === project.activeRevisionId) ?? project.revisions.at(-1)!;
    await this.options.services.findings.create({ type, severity, description, source: { projectId: project.id, revisionId: revision.id, artifactId: slice.source.artifactId, sliceId: slice.id, path: slice.source.path, location: slice.source.location, title: slice.title, startOffset: slice.source.startOffset, endOffset: slice.source.endOffset, startLine: slice.source.startLine, endLine: slice.source.endLine, locator: slice.source.locator } });
    await this.options.services.workflow.decide(project.id, slice.id, type === "Question" ? "question" : "finding");
  }

  private openDialog(action: string): void { const sliceId = this.view().activeSlice?.id ?? ""; this.dialog = action === "add-finding" ? { kind: "finding", title: "Add source-linked finding", description: "Record a concern against the current slice.", targetId: sliceId } : action === "add-question" ? { kind: "question", title: "Add source-linked question", description: "Record clarification that is required.", targetId: sliceId } : action === "skip-slice" ? { kind: "skip", title: "Skip this slice", description: "State why this content is outside the review scope.", targetId: sliceId } : { kind: "note", title: "Add review note", description: "Capture context for this source slice.", targetId: sliceId }; this.render(); }

  private async openFindingSource(findingId: string): Promise<void> { const finding = this.options.services.findings.get(findingId); if (!finding) throw new Error(`Finding ${findingId} does not exist.`); await this.options.services.findings.openSource(findingId); const project = this.options.services.workflow.getProject(finding.source.projectId); if (!project) throw new Error("The linked review project is not available."); await this.options.services.workflow.openProject(project.id); const active = this.options.services.workflow.activeProject()!; const current = active.revisions.find((item) => item.id === active.activeRevisionId) ?? active.revisions.at(-1); const target = current?.slices.find((slice) => reviewUnitSliceIds(active, slice).has(finding.source.sliceId)); if (target) await this.options.services.workflow.selectSlice(active.id, target.id); this.open("review"); }

  private async changeFindingStatus(id: string, status: FindingStatus): Promise<void> { const finding = this.options.services.findings.get(id); if (!finding || finding.status === status) return; if (status === "Verified") { const view = this.view(); const slice = view.activeSlice; const revision = view.project?.revisions.find((item) => item.id === view.project?.activeRevisionId) ?? view.project?.revisions.at(-1); if (!slice || !revision) throw new Error("Open the later revision source before verification."); await this.options.services.findings.verifyAgainstRevision(id, { projectId: finding.source.projectId, revisionId: revision.id, artifactId: slice.source.artifactId, sliceId: slice.id, path: slice.source.path, location: slice.source.location, title: slice.title, locator: slice.source.locator }, "Verified from the active revision."); } else await this.options.services.findings.transitionStatus(id, status); }

  private async confirmMapping(previousSliceId: string, currentSliceId: string): Promise<void> {
    if (!this.comparison) return;
    const mapping = { previousSliceId, currentSliceId, correctedAt: new Date().toISOString(), userConfirmed: true };
    const confirmedMappings = [...this.comparison.confirmedMappings, mapping];
    this.options.services.artifact.createManualMappingSet(this.comparison.comparison.previous, this.comparison.comparison.current, confirmedMappings, mapping.correctedAt);
    const compared = await this.options.services.artifact.compareRevisions(
      this.comparison.comparison.previous,
      this.comparison.comparison.current,
      { reviewerMappings: confirmedMappings, yieldEvery: 100 },
    );
    if (!compared.ok) throw compared.error;
    const rejected = new Set(this.comparison.rejectedCandidateKeys);
    compared.value.uncertainCandidates = compared.value.uncertainCandidates.filter((candidate) => !rejected.has(candidateKey(candidate.previousSliceId, candidate.currentSliceId)));
    this.comparison = { ...this.comparison, confirmedMappings, comparison: compared.value };
    this.notice = "The reviewer-confirmed mapping was applied to the pending revision.";
  }

  private rejectMapping(previousSliceId: string, currentSliceId: string): void {
    if (!this.comparison) return;
    const key = candidateKey(previousSliceId, currentSliceId);
    this.comparison = {
      ...this.comparison,
      rejectedCandidateKeys: [...this.comparison.rejectedCandidateKeys, key],
      comparison: {
        ...this.comparison.comparison,
        uncertainCandidates: this.comparison.comparison.uncertainCandidates.filter((item) => candidateKey(item.previousSliceId, item.currentSliceId) !== key),
      },
    };
    this.notice = "The slices will remain unmatched in the new revision.";
    this.render();
  }

  private async finalizeRevisionImport(): Promise<void> {
    const comparison = this.comparison;
    const result = this.draft.result;
    if (!comparison || !result || this.draft.mode !== "revision") throw new Error("No pending revision is ready to add.");
    if (comparison.comparison.uncertainCandidates.length) throw new Error("Resolve every uncertain mapping before adding the revision.");
    const project = this.requireProject();
    const removed = comparison.comparison.previous
      .filter((slice) => slice.revisionState === "removed")
      .map((slice, index) => ({ ...slice, sequence: comparison.comparison.current.length + index }));
    const slices = [...comparison.comparison.current, ...removed];
    await this.options.services.workflow.addRevision(
      project.id,
      revisionInput(result.artifact.id, result.artifact.displayName, result.artifact.sourceHash, result.artifact.kind, this.draft.revisionLabel, slices),
    );
    this.notice = `${comparison.comparison.counts.modified} modified, ${comparison.comparison.counts.added} added, and ${comparison.comparison.counts.removed} removed slices were classified.`;
    this.draft = freshDraft("new-project");
    this.open("review");
  }
  private async copySource(): Promise<void> { const slice = this.view().activeSlice; if (!slice) return; await this.root.ownerDocument.defaultView?.navigator.clipboard.writeText(`${slice.source.path} · ${slice.source.location}`); this.notice = "Source location copied."; }

  private buildEvidence(): void { const data = this.evidenceData(); this.exportResult = this.options.services.evidence.execute(data); this.notice = "The evidence package is ready for local download."; }
  private async download(name: string): Promise<void> { if (!this.exportResult) this.buildEvidence(); const file = this.exportResult!.downloads.find((item) => item.name === name); if (!file) throw new Error(`${name} is not available in this evidence snapshot.`); if (this.options.saveFile) await this.options.saveFile(file.name, file.content, file.mediaType); else downloadInDocument(this.root.ownerDocument, file.name, file.content, file.mediaType); this.notice = `Saved ${file.name}.`; }

  private evidenceData(): EvidenceExportData {
    const view = this.view(); const project = this.requireProject(); const revision = project.revisions.find((item) => item.id === project.activeRevisionId) ?? project.revisions.at(-1)!;
    const sourceId = revision.id + ":source";
    return { project: { id: project.id, name: project.name, description: project.description, dataLocation: view.dataPath, artifactType: revision.artifactType }, revision: { id: revision.id, label: revision.label, importedAt: revision.importedAt, fileName: revision.fileName, fileHash: revision.fileHash, parserVersion: revision.parserVersion }, reviewDates: { startedAt: project.createdAt, exportedAt: new Date().toISOString(), ...(metrics(view.slices, view.findings).remaining ? {} : { completedAt: project.updatedAt }) }, sources: [{ id: sourceId, path: revision.fileName, hash: revision.fileHash }], slices: revision.slices.map((slice): SliceRecord => ({ id: slice.id, matchKey: slice.stableMatchKey, sourceId, location: slice.source.location, title: slice.title, sequence: slice.sequence, reviewState: evidenceReviewState(slice.reviewState), revisionState: evidenceRevisionState(slice.revisionState), contentHash: normalizedHash(slice.contentHash), ...(slice.parentId ? { parentId: slice.parentId } : {}), ...(slice.reviewedAt ? { reviewedAt: slice.reviewedAt } : {}), ...(slice.skipReason ? { skippedReason: slice.skipReason } : {}) })), findings: view.findings.map((finding): FindingRecord => ({ id: finding.id, type: finding.type, description: finding.description, status: finding.status, sourceSliceId: finding.source.sliceId, sourceLocation: finding.source.location, createdAt: finding.createdAt, updatedAt: finding.updatedAt, ...(finding.severity ? { severity: finding.severity } : {}), ...(finding.resolution ? { resolution: finding.resolution } : {}), ...(finding.externalReference ? { externalReference: finding.externalReference } : {}), ...(finding.relatedFindingId ? { relatedFindingId: finding.relatedFindingId } : {}) })), history: project.history.map((item) => ({ id: item.id, occurredAt: item.occurredAt, action: item.event, ...(item.sliceId ? { sliceId: item.sliceId } : {}), details: { value: item.value, ...(item.previousValue ? { previousValue: item.previousValue } : {}) } })) };
  }

  private requireProject(): ReviewProject { const project = this.options.services.workflow.activeProject(); if (!project) throw new Error("Open a review project first."); return project; }
  private toggleTheme(): void {
    this.colorMode = this.colorMode === "system" ? "light" : this.colorMode === "light" ? "dark" : "system";
    this.modeStorage?.setItem("review-slice.color-mode", this.colorMode);
    this.applyColorMode();
    this.render();
  }

  private applyColorMode(): void {
    const documentRoot = this.root.ownerDocument.documentElement;
    if (this.colorMode === "system") delete documentRoot.dataset.theme;
    else documentRoot.dataset.theme = this.colorMode;
  }
}

function freshDraft(mode: ImportDraft["mode"]): ImportDraft { return { phase: "select", mode, projectName: "", revisionLabel: mode === "revision" ? "Revision B" : "Revision A", sources: [], options: { strategy: "auto", headingDepth: 3, combineBelowCharacters: 120, splitAboveCharacters: 4000 }, warnings: [], excludedMatchKeys: [], busy: false }; }
function revisionInput(artifactId: string, fileName: string, fileHash: string, artifactType: string, label: string, slices: readonly ArtifactSlice[]): ArtifactRevisionInput { return { label, fileName, fileHash, artifactType, parserVersion: "1.0.0", importedAt: new Date().toISOString(), slices: slices.map((slice) => ({ id: slice.id, stableMatchKey: slice.matchKey, ...(slice.parentId ? { parentId: slice.parentId } : {}), ...(slice.previousSliceId ? { previousSliceId: slice.previousSliceId } : {}), title: slice.title, content: slice.content, contentHash: normalizedHash(slice.contentHash), sequence: slice.sequence, source: { artifactId: slice.revisionState === "removed" ? slice.artifactId : artifactId, path: slice.source.path, location: slice.source.locator ?? `Lines ${slice.source.startLine}-${slice.source.endLine}`, startOffset: slice.source.startOffset, endOffset: slice.source.endOffset, startLine: slice.source.startLine, endLine: slice.source.endLine, locator: slice.source.locator }, reviewState: slice.reviewState, revisionState: slice.revisionState })) }; }
function toArtifactSlice(slice: ReviewSlice): ArtifactSlice { return { id: slice.id, matchKey: slice.stableMatchKey, artifactId: slice.source.artifactId, sourceHash: normalizedHash(slice.source.artifactId), contentHash: normalizedHash(slice.contentHash), title: slice.title, content: slice.content, parentId: slice.parentId ?? null, sequence: slice.sequence, source: { path: slice.source.path, startOffset: slice.source.startOffset ?? 0, endOffset: slice.source.endOffset ?? slice.content.length, startLine: slice.source.startLine ?? 1, endLine: slice.source.endLine ?? slice.content.split("\n").length, locator: slice.source.locator ?? slice.source.location, coordinateSystem: "decoded-text" }, preview: { excerpt: slice.content.replace(/\s+/g, " ").slice(0, 280), characterCount: slice.content.length, lineCount: slice.content.split("\n").length }, reviewState: slice.reviewState, revisionState: slice.revisionState, findingIds: [], createdAt: slice.createdAt, updatedAt: slice.updatedAt, previousSliceId: slice.previousSliceId, previousReviewState: slice.previousReviewState }; }
function candidateKey(previousSliceId: string, currentSliceId: string): string { return `${previousSliceId}\u0000${currentSliceId}`; }
function normalizedHash(value: string): string { return /^[a-f0-9]{64}$/i.test(value) ? value.toLocaleLowerCase() : value.padEnd(64, "0").slice(0, 64).replace(/[^a-f0-9]/gi, "0").toLocaleLowerCase(); }
function evidenceReviewState(value: ReviewSlice["reviewState"]): EvidenceReviewState { return ({ "not-reviewed": "Not Reviewed", accepted: "Accepted", finding: "Finding", question: "Question", skipped: "Skipped", "re-review-required": "Re-review Required" } as const)[value]; }
function evidenceRevisionState(value: ReviewSlice["revisionState"]): EvidenceRevisionState { return ({ unchanged: "Unchanged", modified: "Modified", added: "Added", removed: "Removed", relocated: "Relocated", unmatched: "Unmatched" } as const)[value]; }
function isEditing(target: EventTarget | null): boolean { return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable); }
