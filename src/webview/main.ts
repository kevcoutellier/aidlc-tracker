// Dashboard webview — "operations console" for the AI-DLC lifecycle.
// Browser-targeted (bundled to dist/webview.js). Receives a DashboardModel from
// the extension host and renders: masthead + phase stepper, KPI strip, an
// actionable approvals queue, live activity, and a units-of-work board with
// per-stage pipeline indicators and Jira links. No framework, CSP-safe (no
// inline styles/handlers; a single delegated click listener dispatches
// data-command attributes; bar widths set via CSSOM).

import {
  ApprovalItem,
  DashboardModel,
  DashboardPhase,
  DashboardStage,
  DashboardUnit,
  RunView,
  RunningItem,
} from "../model/dashboard";
import { StageStatus } from "../model/types";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const STATUS_LABEL: Record<StageStatus, string> = {
  not_started: "Not started",
  in_progress: "Generating",
  awaiting_approval: "Awaiting approval",
  blocked: "Blocked",
  complete: "Complete",
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string
  );
}

function cmd(command: string, args?: unknown[]): string {
  const payload = args ? ` data-args-json="${esc(JSON.stringify(args))}"` : "";
  return ` data-command="${esc(command)}"${payload} role="button" tabindex="0"`;
}

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// ---------------------------------------------------------------- sections --

function masthead(model: DashboardModel): string {
  const steps = model.phases
    .map((p) => {
      const stateCls =
        p.total > 0 && p.done === p.total
          ? "is-done"
          : p.isCurrent
            ? "is-current"
            : "is-idle";
      return `<div class="step ${stateCls}">
        <span class="step-marker"></span>
        <span class="step-name">${esc(p.name)}</span>
        <span class="step-count">${p.done}/${p.total}</span>
      </div>`;
    })
    .join(`<span class="step-link"></span>`);

  const ext = model.extensions.length
    ? model.extensions.map((n) => `<span class="ext-chip">${esc(n)}</span>`).join("")
    : `<span class="ext-chip none">no extensions</span>`;
  return `<header class="mast">
    <div class="mast-id">
      <p class="micro">AI-DLC · Operations console</p>
      <h1>${esc(model.name)}</h1>
      <div class="ext-row"${cmd("aidlc.configureExtensions")} title="Configure AI-DLC extensions">${ext}</div>
    </div>
    <div class="stepper">${steps}</div>
    <div class="mast-actions">
      <button class="btn primary"${cmd("aidlc.runNextStage")}>▶ Run next stage</button>
      <button class="btn"${cmd("aidlc.syncToJira")}>⇅ Sync Jira</button>
      <button class="btn ghost"${cmd("aidlc.openAuditLog")}>▤ Audit</button>
      <button class="btn ghost"${cmd("aidlc.refresh")}>⟳</button>
    </div>
  </header>`;
}

function kpis(model: DashboardModel): string {
  const overall = pct(model.overallDone, model.overallTotal);
  const sync = model.lastSync
    ? new Date(model.lastSync).toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";
  const cell = (
    label: string,
    value: string,
    sub: string,
    cls = "",
    attrs = ""
  ) => `<div class="kpi ${cls}"${attrs}>
      <span class="micro">${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="kpi-sub">${sub}</span>
    </div>`;

  return `<section class="kpis">
    <div class="kpi kpi-wide">
      <span class="micro">Overall progress</span>
      <span class="kpi-value">${overall}<small>%</small></span>
      <div class="bar" role="progressbar" aria-valuenow="${overall}" aria-valuemin="0" aria-valuemax="100">
        <div class="bar-fill" data-pct="${overall}"></div>
      </div>
      <span class="kpi-sub">${model.overallDone}/${model.overallTotal} items</span>
    </div>
    ${cell("Units of work", `${model.unitsDone}<small>/${model.unitsTotal}</small>`, "construction")}
    ${cell(
      "Awaiting approval",
      String(model.approvals.length),
      model.approvals.length ? "action needed" : "queue clear",
      model.approvals.length ? "attention" : ""
    )}
    ${cell(
      "Blocked",
      String(model.blockedCount),
      model.blockedCount ? "needs a retry" : "none",
      model.blockedCount ? "danger" : ""
    )}
    ${cell(
      "Jira",
      `${model.jiraLinked}<small> linked</small>`,
      `sync ${esc(sync)}`,
      "",
      model.jiraBaseUrl ? "" : ""
    )}
    ${testsKpi(model)}
    ${aiKpi(model)}
  </section>`;
}

function testsKpi(model: DashboardModel): string {
  const t = model.tests.last;
  if (!t) {
    return `<div class="kpi kpi-action"${cmd("aidlc.runTests")} title="Run the project test suite">
      <span class="micro">Tests</span>
      <span class="kpi-value">—</span>
      <span class="kpi-sub">click to run</span>
    </div>`;
  }
  const value =
    t.total !== undefined
      ? `${t.passed ?? 0}<small>/${t.total}</small>`
      : t.ok
        ? "PASS"
        : "FAIL";
  const sub =
    t.coveragePct !== undefined
      ? `coverage ${t.coveragePct}%`
      : `${Math.round(t.durationMs / 1000)}s · ${new Date(t.at).toLocaleTimeString(
          undefined,
          { hour: "2-digit", minute: "2-digit" }
        )}`;
  return `<div class="kpi kpi-action ${t.ok ? "good" : "danger"}"${cmd(
    "aidlc.runTests"
  )} title="${esc(t.command)} — click to re-run">
    <span class="micro">Tests</span>
    <span class="kpi-value">${value}</span>
    <span class="kpi-sub">${esc(sub)}</span>
  </div>`;
}

function aiKpi(model: DashboardModel): string {
  const value =
    model.ai.costUsd !== undefined
      ? `$${model.ai.costUsd.toFixed(2)}`
      : String(model.ai.count);
  const sub = `${model.ai.count} runs · ${Math.round(
    model.ai.totalDurationMs / 1000
  )}s total`;
  return `<div class="kpi">
    <span class="micro">AI generation</span>
    <span class="kpi-value">${value}</span>
    <span class="kpi-sub">${esc(sub)}</span>
  </div>`;
}

function approvalsQueue(model: DashboardModel): string {
  if (model.approvals.length === 0) {
    return "";
  }
  const rows = model.approvals
    .map((a: ApprovalItem) => {
      const ref = [{ stageId: a.stageId, unitId: a.unitId }];
      const scope = a.unitTitle
        ? `<span class="row-scope">${esc(a.unitTitle)}</span>`
        : `<span class="row-scope">inception</span>`;
      const open = a.artifactPath
        ? `<button class="btn ghost"${cmd("aidlc.openArtifact", [a.artifactPath])}>Open</button>`
        : "";
      return `<div class="row approval">
        <span class="pulse amber"></span>
        <div class="row-main">
          <span class="row-title">${esc(a.stageName)}</span>
          ${scope}
        </div>
        <div class="row-actions">
          ${open}
          <button class="btn"${cmd("aidlc.requestChanges", ref)}>✎ Changes</button>
          <button class="btn primary"${cmd("aidlc.approveArtifact", ref)}>✓ Approve</button>
        </div>
      </div>`;
    })
    .join("");
  return `<section class="panel attention-rail">
    <header class="panel-head">
      <h2>Approval queue</h2>
      <span class="count-chip">${model.approvals.length}</span>
    </header>
    ${rows}
  </section>`;
}

function runningNow(model: DashboardModel): string {
  if (model.running.length === 0) {
    return "";
  }
  const rows = model.running
    .map(
      (r: RunningItem) => `<div class="row">
        <span class="pulse blue"></span>
        <div class="row-main">
          <span class="row-title">${esc(r.stageName)}</span>
          ${r.unitTitle ? `<span class="row-scope">${esc(r.unitTitle)}</span>` : ""}
        </div>
        <span class="row-hint">cancel from the notification</span>
      </div>`
    )
    .join("");
  return `<section class="panel running-rail">
    <header class="panel-head"><h2>Generating now</h2></header>
    ${rows}
  </section>`;
}

function testsPanel(model: DashboardModel): string {
  const t = model.tests;
  if (!t.last && t.history.length === 0) {
    return "";
  }
  const bars = t.history
    .map(
      (h, i) =>
        `<span class="tbar ${h.ok ? "ok" : "fail"}" data-h="${Math.max(
          h.rate,
          8
        )}" title="run ${i + 1}: ${h.rate}%"></span>`
    )
    .join("");
  const last = t.last;
  const meta = last
    ? [
        last.ok ? "PASS" : "FAIL",
        last.total !== undefined
          ? `${last.passed ?? 0}/${last.total}${
              last.failed ? ` (${last.failed} failed)` : ""
            }`
          : undefined,
        last.coveragePct !== undefined ? `cov ${last.coveragePct}%` : undefined,
        `${Math.round(last.durationMs / 1000)}s`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "no runs yet";
  return `<section class="panel${last && !last.ok ? " fail-rail" : ""}">
    <header class="panel-head">
      <h2>Tests</h2>
      <span class="panel-meta">${esc(meta)}</span>
      <span class="panel-spacer"></span>
      <button class="btn"${cmd("aidlc.runTests")}>⏵ Run tests</button>
    </header>
    <div class="tbars">${bars || `<span class="empty-hint">history appears after the first run</span>`}</div>
  </section>`;
}

function recentRuns(model: DashboardModel): string {
  if (model.runs.length === 0) {
    return "";
  }
  const rows = model.runs
    .map((r: RunView) => {
      const when = new Date(r.at).toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const meta = [
        r.model,
        r.turns !== undefined ? `${r.turns}t` : undefined,
        r.durationMs !== undefined
          ? `${Math.round(r.durationMs / 1000)}s`
          : undefined,
        r.costUsd !== undefined ? `$${r.costUsd.toFixed(4)}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="row run-row">
        <span class="run-when">${esc(when)}</span>
        <div class="row-main">
          <span class="row-title">${esc(r.stageName)}</span>
          <span class="row-scope">${
            r.unitTitle ? esc(r.unitTitle) + " · " : ""
          }${esc(r.tools || "no tools")}${
            r.agents.length
              ? ` · <b>subagents: ${esc(r.agents.join(", "))}</b>`
              : ""
          }</span>
        </div>
        <span class="run-meta">${esc(meta)}</span>
      </div>`;
    })
    .join("");
  return `<section class="panel">
    <header class="panel-head"><h2>Recent runs</h2><span class="panel-meta">model · turns · duration · cost</span></header>
    ${rows}
  </section>`;
}

function stageChip(stage: DashboardStage, unitId?: string): string {
  const clickable = stage.hasArtifact && stage.artifactPath;
  const attrs = clickable
    ? cmd("aidlc.openArtifact", [stage.artifactPath])
    : ` title="${esc(STATUS_LABEL[stage.status])}"`;
  void unitId;
  return `<span class="chip st-${stage.status}${clickable ? " clickable" : ""}"${attrs}>
    <span class="dot"></span>${esc(stage.name)}
  </span>`;
}

function pipeline(unit: DashboardUnit): string {
  const segs = unit.stages
    .map((s) => {
      const clickable = s.hasArtifact && s.artifactPath;
      const attrs = clickable
        ? cmd("aidlc.openArtifact", [s.artifactPath])
        : "";
      return `<span class="seg st-${s.status}${clickable ? " clickable" : ""}" title="${esc(
        s.name
      )} — ${esc(STATUS_LABEL[s.status])}"${attrs}></span>`;
    })
    .join("");
  return `<span class="pipeline">${segs}</span>`;
}

const PR_GLYPH: Record<string, string> = {
  open: "●",
  merged: "⬤✓",
  closed: "✕",
};
const CHECKS_GLYPH: Record<string, string> = {
  passing: "✓",
  failing: "✗",
  pending: "…",
  none: "",
};

function devCell(unit: DashboardUnit): string {
  const dev = unit.dev;
  if (!dev) {
    return `<span class="dev-none">—</span>`;
  }
  const parts: string[] = [];
  if (dev.commitCount > 0) {
    parts.push(
      `<span class="dev-commits" title="${esc(
        dev.lastCommit ? `last: ${dev.lastCommit}` : "commits mentioning the key"
      )}">⧟ ${dev.commitCount}</span>`
    );
  }
  if (dev.branch) {
    parts.push(`<span class="dev-branch" title="${esc(dev.branch)}">⎇</span>`);
  }
  for (const pr of dev.prs) {
    const checks = pr.checks ? CHECKS_GLYPH[pr.checks] ?? "" : "";
    parts.push(
      `<span class="pr-chip pr-${pr.state}"${cmd("aidlc.openExternalGitHub", [
        pr.url,
      ])} title="${esc(pr.title)} — ${pr.state}${
        pr.draft ? " (draft)" : ""
      }${pr.checks ? ` · checks ${pr.checks}` : ""}">#${pr.number} ${
        PR_GLYPH[pr.state] ?? ""
      }${checks}</span>`
    );
  }
  return parts.length ? parts.join(" ") : `<span class="dev-none">·</span>`;
}

function unitRow(unit: DashboardUnit): string {
  const jira = unit.jiraKey
    ? `<span class="jira-chip"${cmd("aidlc.openJiraIssue", [unit.jiraKey])} title="Open in Jira${
        unit.jiraStatus ? ` — ${esc(unit.jiraStatus)}` : ""
      }">${esc(unit.jiraKey)} ↗</span>`
    : `<span class="jira-chip none">—</span>`;
  return `<tr class="unit-row st-row-${unit.status}">
    <td class="td-status"><span class="dot st-${unit.status}" title="${esc(
      STATUS_LABEL[unit.status]
    )}"></span></td>
    <td class="td-title">${esc(unit.title)}</td>
    <td class="td-jira">${jira}</td>
    <td class="td-pipeline">${pipeline(unit)}</td>
    <td class="td-dev">${devCell(unit)}</td>
    <td class="td-count">${unit.done}<small>/${unit.total}</small></td>
    <td class="td-run">${
      unit.handoffReady
        ? `<span class="run-all"${cmd("aidlc.handoffUnit", [
            { unitId: unit.id },
          ])} title="Hand off the approved code plan to a Claude Code session">⇢</span>`
        : ""
    }${
      unit.status === "complete"
        ? ""
        : `<span class="run-all"${cmd("aidlc.runUnitPipeline", [
            { unitId: unit.id },
          ])} title="Run all remaining stages with auto-approve">▶▶</span>`
    }</td>
  </tr>`;
}

function constructionPanel(phase: DashboardPhase, model: DashboardModel): string {
  const body = phase.units.length
    ? `<table class="units">
        <thead><tr>
          <th></th><th>Unit of work</th><th>Jira</th><th>Pipeline</th><th>Dev</th><th>Done</th><th></th>
        </tr></thead>
        <tbody>${phase.units.map(unitRow).join("")}</tbody>
      </table>`
    : `<p class="empty-hint">No units yet — pull them from Jira or add one manually.</p>`;

  const branchBit = model.devBranch
    ? ` · ⎇ ${esc(model.devBranch)}${
        model.devBehindMain ? ` (−${model.devBehindMain} vs main)` : ""
      }`
    : "";
  const devMeta = model.devError
    ? `<span class="dev-status warn" title="${esc(model.devError)}">dev: partial${branchBit}</span>`
    : model.devRepo
      ? `<span class="dev-status${model.devBehindMain ? " warn" : ""}" title="workspace checkout">dev: ${esc(
          model.devRepo
        )}${branchBit}</span>`
      : `<span class="dev-status">dev: local git only${branchBit}</span>`;

  return `<section class="panel${phase.isCurrent ? " current" : ""}">
    <header class="panel-head">
      <h2>${esc(phase.name)}${phase.isCurrent ? `<span class="badge">current</span>` : ""}</h2>
      <span class="panel-meta">${phase.done}/${phase.total} complete</span>
      ${devMeta}
      <span class="panel-spacer"></span>
      <button class="btn ghost"${cmd("aidlc.refreshDevActivity")}>⧟ Refresh dev</button>
      <button class="btn ghost"${cmd("aidlc.importUnitsFromJira")}>⇩ From Jira</button>
      <button class="btn ghost"${cmd("aidlc.addUnitOfWork")}>＋ Unit</button>
    </header>
    ${body}
  </section>`;
}

function phasePanel(phase: DashboardPhase, model: DashboardModel): string {
  if (phase.isConstruction) {
    return constructionPanel(phase, model);
  }
  return `<section class="panel${phase.isCurrent ? " current" : ""}">
    <header class="panel-head">
      <h2>${esc(phase.name)}${phase.isCurrent ? `<span class="badge">current</span>` : ""}</h2>
      <span class="panel-meta">${phase.done}/${phase.total} complete</span>
    </header>
    <div class="chips">${phase.stages.map((s) => stageChip(s)).join("")}</div>
  </section>`;
}

// ------------------------------------------------------------------ render --

function render(model: DashboardModel): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  if (!model.hasProject) {
    root.innerHTML = `<div class="empty">
      <p class="micro">AI-DLC · Operations console</p>
      <h1>No project detected</h1>
      <p class="empty-hint">Initialize the AI-DLC structure to start tracking.</p>
      <button class="btn primary"${cmd("aidlc.initProject")}>Initialize AI-DLC project</button>
    </div>`;
    return;
  }

  root.innerHTML = [
    masthead(model),
    kpis(model),
    approvalsQueue(model),
    runningNow(model),
    `<div class="phase-grid">${model.phases
      .map((p) => phasePanel(p, model))
      .join("")}</div>`,
    testsPanel(model),
    recentRuns(model),
  ].join("");

  applyBars(root);
}

function applyBars(root: HTMLElement): void {
  // CSP-safe dynamic sizing: widths/heights via CSSOM, never inline styles.
  root.querySelectorAll<HTMLElement>(".bar-fill").forEach((el) => {
    const p = el.getAttribute("data-pct");
    if (p !== null) {
      el.style.width = `${p}%`;
    }
  });
  root.querySelectorAll<HTMLElement>("[data-h]").forEach((el) => {
    const h = el.getAttribute("data-h");
    if (h !== null) {
      el.style.height = `${h}%`;
    }
  });
}

// -------------------------------------------------------------- dispatcher --

function dispatchFrom(el: Element | null): void {
  const target = el?.closest<HTMLElement>("[data-command]");
  if (!target) {
    return;
  }
  const command = target.getAttribute("data-command")!;
  let args: unknown[] = [];
  const json = target.getAttribute("data-args-json");
  if (json) {
    try {
      args = JSON.parse(json) as unknown[];
    } catch {
      args = [];
    }
  }
  vscode.postMessage({ type: "command", command, args });
}

document.addEventListener("click", (e) =>
  dispatchFrom(e.target as Element | null)
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const el = e.target as Element | null;
    if (el?.closest("[data-command]")) {
      e.preventDefault();
      dispatchFrom(el);
    }
  }
});

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.type === "state") {
    render(msg.model as DashboardModel);
  }
});

vscode.postMessage({ type: "ready" });
