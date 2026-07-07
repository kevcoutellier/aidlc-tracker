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
  runs: RunView[];
  blockedCount: number;
  unitsDone: number;
  unitsTotal: number;
  jiraLinked: number;
  jiraBaseUrl?: string;
}

/** Host-side extras that the pure model builder can't read itself. */
export interface DashboardModelOptions {
  jiraBaseUrl?: string;
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
    tools: Object.entries(r.tools ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name}×${count}`)
      .join(" · "),
    agents: r.agents ?? [],
  }));

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
    runs,
    blockedCount,
    unitsDone: state.units.filter((u) => u.status === "complete").length,
    unitsTotal: state.units.length,
    jiraLinked: state.units.filter((u) => u.jiraKey).length,
    jiraBaseUrl: options.jiraBaseUrl,
  };
}
