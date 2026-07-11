/**
 * Serializable view model shared between the extension host and the dashboard
 * webview. Must not import `vscode` — the webview bundle is browser-targeted.
 */

import { PhaseId, ProjectState, StageStatus } from "./types";
import {
  PHASES,
  artifactPath,
  stageById,
  stagesForPhase,
} from "./aidlcDefinition";
import { DevActivity, UnitDevInfo } from "../integrations/github/devModel";
import { enabledExtensionNames } from "./extensions";

export type { DevActivity, UnitDevInfo, PrInfo } from "../integrations/github/devModel";

export interface DashboardStage {
  id: string;
  name: string;
  status: StageStatus;
  hasArtifact: boolean;
  artifactPath?: string;
}

export interface DashboardUnit {
  id: string;
  title: string;
  status: StageStatus;
  jiraKey?: string;
  jiraStatus?: string;
  stages: DashboardStage[];
  done: number;
  total: number;
  dev?: UnitDevInfo;
  /** True once the unit's code plan is approved — it can be handed off. */
  handoffReady: boolean;
}

export interface DashboardPhase {
  id: PhaseId;
  name: string;
  description: string;
  isCurrent: boolean;
  isConstruction: boolean;
  done: number;
  total: number;
  stages: DashboardStage[];
  units: DashboardUnit[];
}

/** A stage waiting for a human decision. */
export interface ApprovalItem {
  stageId: string;
  stageName: string;
  unitId?: string;
  unitTitle?: string;
  artifactPath?: string;
}

/** A stage currently generating. */
export interface RunningItem {
  stageId: string;
  stageName: string;
  unitId?: string;
  unitTitle?: string;
}

/** One subagent (Task) call observed live during a generation. */
export interface LiveTaskView {
  /** tool_use id — correlates the start with its tool_result. */
  id: string;
  agent: string;
  brief?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Live snapshot of the generation currently running, streamed from the
 * orchestrator into the dashboard. Epoch-ms timestamps so the webview can
 * tick elapsed time locally between host updates.
 */
export interface LiveRunView {
  stageId: string;
  stageName: string;
  unitId?: string;
  unitTitle?: string;
  startedAt: number;
  /** Generation budgets (claudeCode backend only). */
  timeoutMs?: number;
  maxTurns?: number;
  turns: number;
  model?: string;
  tools: Record<string, number>;
  tasks: LiveTaskView[];
  /** Last one-line tool activity, e.g. "Read · src/index.ts". */
  lastActivity?: string;
}

/** "Read×12 · Grep×3" — top tool calls, most used first. */
export function summarizeTools(
  tools: Record<string, number>,
  top = 4
): string {
  return Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([name, count]) => `${name}×${count}`)
    .join(" · ");
}

/** Milliseconds → "m:ss" (e.g. 83000 → "1:23"). */
export function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** value/max as a 0–100 integer percentage, clamped. */
export function clampPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

/** Aggregated test-suite health for the KPI strip and Tests panel. */
export interface TestsView {
  last?: {
    at: string;
    ok: boolean;
    passed?: number;
    failed?: number;
    total?: number;
    coveragePct?: number;
    durationMs: number;
    command: string;
  };
  /** Newest-last (chronological) mini-history for the bar strip. */
  history: Array<{ ok: boolean; rate: number }>;
}

/** Aggregated AI-generation stats across recorded runs. */
export interface AiStatsView {
  count: number;
  costUsd?: number;
  totalDurationMs: number;
}

/** A past generation run, for the "recent runs" panel. */
export interface RunView {
  stageName: string;
  unitTitle?: string;
  at: string;
  model?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number;
  /** Pre-formatted tool usage, e.g. "Read×12 · Grep×3". */
  tools: string;
  agents: string[];
}

export interface DashboardModel {
  hasProject: boolean;
  name: string;
  currentPhase: PhaseId;
  phases: DashboardPhase[];
  overallDone: number;
  overallTotal: number;
  lastSync?: string;
  approvals: ApprovalItem[];
  running: RunningItem[];
  /** Live view of the in-flight generation, when one is running. */
  live?: LiveRunView;
  runs: RunView[];
  tests: TestsView;
  ai: AiStatsView;
  /** Names of enabled AI-DLC extensions. */
  extensions: string[];
  blockedCount: number;
  unitsDone: number;
  unitsTotal: number;
  jiraLinked: number;
  jiraBaseUrl?: string;
  /** Repo + freshness of the dev-activity snapshot, when available. */
  devRepo?: string;
  devBranch?: string;
  devBehindMain?: number;
  devFetchedAt?: string;
  devError?: string;
}

/** Host-side extras that the pure model builder can't read itself. */
export interface DashboardModelOptions {
  jiraBaseUrl?: string;
  dev?: DevActivity;
  live?: LiveRunView;
}

/** Message posted from the extension host into the webview. */
export interface HostStateMessage {
  type: "state";
  model: DashboardModel;
}

/** Message posted from the webview back to the extension host. */
export interface WebviewCommandMessage {
  type: "command";
  command: string;
  args?: unknown[];
}

function stageView(
  stageId: string,
  status: StageStatus,
  artifactRelPath: string | undefined,
  hasArtifact: boolean
): DashboardStage {
  return {
    id: stageId,
    name: stageById(stageId)?.name ?? stageId,
    status,
    hasArtifact,
    artifactPath: hasArtifact ? artifactRelPath : undefined,
  };
}

function emptyModel(): DashboardModel {
  return {
    hasProject: false,
    name: "",
    currentPhase: "inception",
    phases: [],
    overallDone: 0,
    overallTotal: 0,
    approvals: [],
    running: [],
    runs: [],
    tests: { history: [] },
    ai: { count: 0, totalDurationMs: 0 },
    extensions: [],
    blockedCount: 0,
    unitsDone: 0,
    unitsTotal: 0,
    jiraLinked: 0,
  };
}

/** Build the dashboard model from project state (undefined => empty state). */
export function buildDashboardModel(
  state: ProjectState | undefined,
  options: DashboardModelOptions = {}
): DashboardModel {
  if (!state) {
    return emptyModel();
  }

  let overallDone = 0;
  let overallTotal = 0;
  const approvals: ApprovalItem[] = [];
  const running: RunningItem[] = [];
  let blockedCount = 0;

  const track = (
    s: DashboardStage,
    unitId?: string,
    unitTitle?: string
  ): void => {
    if (s.status === "awaiting_approval") {
      approvals.push({
        stageId: s.id,
        stageName: s.name,
        unitId,
        unitTitle,
        artifactPath: s.artifactPath,
      });
    } else if (s.status === "in_progress") {
      running.push({ stageId: s.id, stageName: s.name, unitId, unitTitle });
    } else if (s.status === "blocked") {
      blockedCount++;
    }
  };

  const phases: DashboardPhase[] = PHASES.map((phase) => {
    const isConstruction = phase.id === "construction";
    const stages: DashboardStage[] = [];
    const units: DashboardUnit[] = [];
    let done = 0;
    let total = 0;

    if (isConstruction) {
      for (const unit of state.units) {
        const unitStages = stagesForPhase("construction")
          .filter((s) => s.perUnit)
          .map((s) => {
            const st = unit.stages[s.id];
            const rel = artifactPath(s, unit.id);
            const view = stageView(
              s.id,
              st?.status ?? "not_started",
              rel,
              !!st?.artifactPath
            );
            track(view, unit.id, unit.title);
            return view;
          });
        const unitDone = unitStages.filter(
          (s) => s.status === "complete"
        ).length;
        units.push({
          id: unit.id,
          title: unit.title,
          status: unit.status,
          jiraKey: unit.jiraKey,
          jiraStatus: unit.jiraStatus,
          stages: unitStages,
          done: unitDone,
          total: unitStages.length,
          dev: options.dev?.byUnit[unit.id],
          handoffReady:
            unit.stages["code-generation"]?.status === "complete",
        });
      }
      total = state.units.length;
      done = state.units.filter((u) => u.status === "complete").length;
    } else {
      for (const s of phase.stages.filter((x) => !x.perUnit)) {
        const st = state.stages[s.id];
        const rel = artifactPath(s);
        const view = stageView(
          s.id,
          st?.status ?? "not_started",
          rel,
          !!st?.artifactPath
        );
        track(view);
        stages.push(view);
      }
      total = stages.length;
      done = stages.filter((s) => s.status === "complete").length;
    }

    overallDone += done;
    overallTotal += total;

    return {
      id: phase.id,
      name: phase.name,
      description: phase.description,
      isCurrent: phase.id === state.currentPhase,
      isConstruction,
      done,
      total,
      stages,
      units,
    };
  });

  const runs: RunView[] = (state.runs ?? []).slice(0, 8).map((r) => ({
    stageName: stageById(r.stageId)?.name ?? r.stageId,
    unitTitle: r.unitId
      ? state.units.find((u) => u.id === r.unitId)?.title ?? r.unitId
      : undefined,
    at: r.at,
    model: r.model,
    turns: r.turns,
    durationMs: r.durationMs,
    costUsd: r.costUsd,
    tools: summarizeTools(r.tools ?? {}),
    agents: r.agents ?? [],
  }));

  const testRuns = state.testRuns ?? [];
  const lastTest = testRuns[0];
  const tests: TestsView = {
    last: lastTest
      ? {
          at: lastTest.at,
          ok: lastTest.ok,
          passed: lastTest.passed,
          failed: lastTest.failed,
          total: lastTest.total,
          coveragePct: lastTest.coveragePct,
          durationMs: lastTest.durationMs,
          command: lastTest.command,
        }
      : undefined,
    history: testRuns
      .slice(0, 12)
      .reverse()
      .map((t) => ({
        ok: t.ok,
        rate:
          t.total && t.total > 0
            ? Math.round(((t.passed ?? 0) / t.total) * 100)
            : t.ok
              ? 100
              : 0,
      })),
  };

  const aiRuns = state.runs ?? [];
  const costs = aiRuns.filter((r) => r.costUsd !== undefined);
  const ai: AiStatsView = {
    count: aiRuns.length,
    costUsd: costs.length
      ? costs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
      : undefined,
    totalDurationMs: aiRuns.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
  };

  return {
    hasProject: true,
    name: state.name,
    currentPhase: state.currentPhase,
    phases,
    overallDone,
    overallTotal,
    lastSync: state.lastSync,
    approvals,
    running,
    live: options.live,
    runs,
    tests,
    ai,
    extensions: enabledExtensionNames(state.extensions),
    blockedCount,
    unitsDone: state.units.filter((u) => u.status === "complete").length,
    unitsTotal: state.units.length,
    jiraLinked: state.units.filter((u) => u.jiraKey).length,
    jiraBaseUrl: options.jiraBaseUrl,
    devRepo: options.dev?.repo
      ? `${options.dev.repo.owner}/${options.dev.repo.name}`
      : undefined,
    devBranch: options.dev?.repoBranch,
    devBehindMain: options.dev?.behindMain,
    devFetchedAt: options.dev?.fetchedAt,
    devError: options.dev?.error,
  };
}
