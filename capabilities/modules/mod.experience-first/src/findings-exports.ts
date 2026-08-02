import type { FindingStatus, ManagedFinding, WorkspaceView } from "./contracts.ts";
import { attribute, escapeHtml, icon, pageHeading } from "./dom.ts";
import { formatDate, metrics } from "./view-model.ts";

const statuses: readonly ("all" | FindingStatus)[] = ["all", "Open", "Addressed", "Verified", "Rejected", "Deferred"];

export function renderFindings(view: WorkspaceView): string {
  const query = view.findingQuery.trim().toLocaleLowerCase();
  const visible = view.findings.filter((finding) => {
    const matchesText = !query || `${finding.id} ${finding.type} ${finding.description} ${finding.source.title} ${finding.source.location}`.toLocaleLowerCase().includes(query);
    return matchesText && (view.findingStatus === "all" || finding.status === view.findingStatus);
  });
  return `<section class="eui-page findings-page" data-view="findings" aria-labelledby="findings-title">
    ${pageHeading({ id: "findings-title", eyebrow: "Source-linked register", title: "Findings", summary: "Track each concern from discovery through later revision verification.", actions: `<button class="eui-button secondary" type="button" data-action="download-findings" data-format="csv">${icon("download")}Export CSV</button><button class="eui-button primary" type="button" data-action="open-review">${icon("book-open")}Open review</button>` })}
    <section class="finding-summary" aria-label="Finding status counts">${["Open", "Addressed", "Verified", "Deferred"].map((status) => `<button type="button" data-action="filter-finding-status" data-status="${status}" class="finding-summary-cell"><span>${status}</span><strong>${view.findings.filter((finding) => finding.status === status).length}</strong></button>`).join("")}</section>
    <section class="eui-panel findings-register" aria-labelledby="register-title">
      <div class="panel-heading findings-tools"><div><p class="eyebrow">Current project</p><h2 id="register-title">${visible.length} ${visible.length === 1 ? "record" : "records"}</h2></div><div class="table-tools"><label class="search-control">${icon("search")}<span class="sr-only">Search findings</span><input type="search" placeholder="Search ID, source, or text" value="${attribute(view.findingQuery)}" data-field="findingQuery"></label><label class="select-control">${icon("filter")}<span class="sr-only">Filter finding status</span><select data-field="findingStatus">${statuses.map((status) => `<option value="${status}" ${view.findingStatus === status ? "selected" : ""}>${status === "all" ? "All statuses" : status}</option>`).join("")}</select></label></div></div>
      ${visible.length ? `<div class="table-scroll"><table class="eui-table findings-table"><thead><tr><th>Finding</th><th>Source section</th><th>Type</th><th>Severity</th><th>Status</th><th>Created</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${visible.map(findingRow).join("")}</tbody></table></div>` : `<div class="empty-inline"><p>No findings match this search and status filter.</p><button class="eui-link" type="button" data-action="clear-finding-filter">Clear filters</button></div>`}
    </section>
  </section>`;
}

function findingRow(finding: ManagedFinding): string {
  return `<tr><td><button class="record-link plain" type="button" data-action="open-finding" data-finding-id="${attribute(finding.id)}"><span class="finding-id">${escapeHtml(finding.id)}</span><strong>${escapeHtml(finding.description)}</strong>${finding.resolution ? `<small>Resolution: ${escapeHtml(finding.resolution)}</small>` : ""}</button></td><td><button class="source-link" type="button" data-action="open-finding-source" data-finding-id="${attribute(finding.id)}"><strong>${escapeHtml(finding.source.title)}</strong><code>${escapeHtml(finding.source.location)}</code></button></td><td>${escapeHtml(finding.type)}</td><td><span class="severity ${String(finding.severity ?? "Info").toLocaleLowerCase()}">${escapeHtml(finding.severity ?? "Info")}</span></td><td><select class="status-select ${finding.status.toLocaleLowerCase()}" aria-label="Status for ${attribute(finding.id)}" data-action="finding-status" data-finding-id="${attribute(finding.id)}">${allowedStatuses(finding.status).map((status) => `<option value="${status}">${status}</option>`).join("")}</select></td><td><time datetime="${attribute(finding.createdAt)}">${escapeHtml(formatDate(finding.createdAt))}</time></td><td><div class="project-actions"><button class="icon-button" type="button" data-action="edit-finding" data-finding-id="${attribute(finding.id)}" aria-label="Edit ${attribute(finding.id)}" data-tooltip="Edit finding">${icon("settings-2")}</button><button class="icon-button" type="button" data-action="finding-resolution" data-finding-id="${attribute(finding.id)}" aria-label="Add resolution note for ${attribute(finding.id)}" data-tooltip="Resolution note">${icon("more-horizontal")}</button></div></td></tr>`;
}

function allowedStatuses(status: FindingStatus): readonly FindingStatus[] {
  const transitions: Record<FindingStatus, readonly FindingStatus[]> = {
    Open: ["Addressed", "Rejected", "Deferred"],
    Addressed: ["Open", "Verified", "Rejected", "Deferred"],
    Verified: ["Open", "Deferred"],
    Rejected: ["Open", "Deferred"],
    Deferred: ["Open", "Addressed", "Rejected"],
  };
  return [status, ...transitions[status]];
}

export function renderEvidence(view: WorkspaceView): string {
  const currentMetrics = metrics(view.slices, view.findings);
  const ready = currentMetrics.remaining === 0;
  const result = view.exportResult;
  return `<section class="eui-page evidence-page" data-view="evidence" aria-labelledby="evidence-title">
    ${pageHeading({ id: "evidence-title", eyebrow: "Review evidence", title: "Evidence package", summary: "Create deterministic local reports that explain what was reviewed and when.", actions: `<button class="eui-button primary" type="button" data-action="build-evidence">${icon("download")}Prepare evidence</button>` })}
    <div class="evidence-layout">
      <section class="eui-panel evidence-readiness" aria-labelledby="readiness-title"><div class="panel-heading"><div><p class="eyebrow">Completion gate</p><h2 id="readiness-title">${ready ? "Ready to export" : "Review in progress"}</h2></div><span class="readiness-ring ${ready ? "ready" : ""}" style="--progress:${currentMetrics.completionPercent * 3.6}deg"><strong>${currentMetrics.completionPercent}%</strong></span></div>
        <div class="readiness-list"><p class="${currentMetrics.remaining ? "pending" : "complete"}">${currentMetrics.remaining ? icon("triangle-alert") : icon("check")}<span><strong>Slice dispositions</strong><small>${currentMetrics.remaining ? `${currentMetrics.remaining} still require review` : "Every reviewable slice has a disposition"}</small></span></p><p class="${currentMetrics.openFindings ? "pending" : "complete"}">${currentMetrics.openFindings ? icon("triangle-alert") : icon("check")}<span><strong>Finding lifecycle</strong><small>${currentMetrics.openFindings ? `${currentMetrics.openFindings} open or addressed` : "No unresolved findings"}</small></span></p><p class="complete">${icon("check")}<span><strong>Source manifest</strong><small>Source paths and hashes are available</small></span></p><p class="complete">${icon("check")}<span><strong>Review history</strong><small>Local action history is available</small></span></p></div>
      </section>
      <section class="eui-panel package-contents" aria-labelledby="contents-title"><div class="panel-heading"><div><p class="eyebrow">Required package</p><h2 id="contents-title">Evidence contents</h2></div><span class="status-chip success">5 required files</span></div>
        <ul class="file-manifest">${[["review-summary.md", "Review scope, dates, counts, and exceptions"], ["findings.csv", "Source-linked findings register"], ["review-history.json", "Chronological review actions"], ["slice-manifest.json", "Stable slice IDs, hashes, states, and locations"], ["source-manifest.json", "Immutable source file references and hashes"]].map(([name, detail]) => `<li>${icon("files")}<span><code>${name}</code><small>${detail}</small></span><span class="status-text success"><i></i>Ready</span></li>`).join("")}</ul>
      </section>
    </div>
    <section class="eui-panel export-actions" aria-labelledby="downloads-title"><div class="panel-heading"><div><p class="eyebrow">Local downloads</p><h2 id="downloads-title">Reports and registers</h2></div>${result ? `<span class="hash-proof">Package SHA-256 <code>${escapeHtml(result.evidencePackage.contentHash.slice(0, 16))}…</code></span>` : `<span class="record-count">Prepare the current snapshot first</span>`}</div>
      <div class="download-grid"><button type="button" data-action="download-evidence" data-name="review-summary.md" ${result ? "" : "disabled"}>${icon("download")}<span><strong>Review summary</strong><small>Markdown</small></span></button><button type="button" data-action="download-evidence" data-name="findings.csv" ${result ? "" : "disabled"}>${icon("download")}<span><strong>Findings register</strong><small>CSV</small></span></button><button type="button" data-action="download-evidence" data-name="findings.json" ${result ? "" : "disabled"}>${icon("download")}<span><strong>Findings register</strong><small>JSON</small></span></button><button class="primary-download" type="button" data-action="download-evidence" data-name="review-evidence.zip" ${result ? "" : "disabled"}>${icon("archive")}<span><strong>Complete evidence ZIP</strong><small>Five required evidence files</small></span></button></div>
    </section>
    <footer class="data-location">${icon("folder-open")}<span><strong>Exports stay local</strong><code>${escapeHtml(view.dataPath)}</code></span><span class="offline-badge">No network</span></footer>
  </section>`;
}
