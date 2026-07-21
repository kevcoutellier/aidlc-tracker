/**
 * Pure (vscode-free) serialization for the AI-DLC state file. Kept separate from
 * {@link ./StateWriter} so it can be unit-tested under plain Node.
 */

import {
  PersistedState,
  ProjectState,
  StageState,
  StageStatus,
} from "../model/types";
import { PHASES, phaseById } from "../model/aidlcDefinition";

export const STATE_BEGIN = "<!-- AIDLC-STATE:BEGIN";
export const STATE_END = "AIDLC-STATE:END -->";

const STATUS_LABEL: Record<StageStatus, string> = {
  not_started: "not started",
  in_progress: "in progress",
  awaiting_approval: "awaiting approval",
  blocked: "blocked",
  complete: "complete",
};

/**
 * Canonicalize a status value read from the state block. External agents
 * (e.g. the AWS aidlc-workflows rules running in Kiro) edit this file and
 * write natural-language variants — "completed", "in progress", "done" —
 * which must map onto the strict enum instead of reaching the UI as unknown
 * strings (rendered as not-started). Returns undefined when the value carries
 * no recognizable signal.
 */
export function normalizeStageStatus(value: unknown): StageStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  switch (value.trim().toLowerCase().replace(/[\s-]+/g, "_")) {
    case "not_started":
    case "notstarted":
    case "pending":
    case "todo":
    case "new":
      return "not_started";
    case "in_progress":
    case "inprogress":
    case "started":
    case "running":
    case "active":
    case "generating":
    case "revising":
      return "in_progress";
    case "awaiting_approval":
    case "awaitingapproval":
    case "awaiting_review":
    case "pending_approval":
    case "pending_review":
    case "in_review":
    case "review":
      return "awaiting_approval";
    case "blocked":
    case "on_hold":
    case "stuck":
      return "blocked";
    case "complete":
    case "completed":
    case "done":
    case "finished":
    case "approved":
      return "complete";
    default:
      return undefined;
  }
}

/** Drop entries without a usable status; canonicalize the rest. */
function sanitizeStageEntries(
  stages: Record<string, StageState> | undefined
): Record<string, StageState> {
  const out: Record<string, StageState> = {};
  for (const [id, entry] of Object.entries(stages ?? {})) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const status = normalizeStageStatus(entry.status);
    if (!status) {
      continue; // no usable signal — artifact presence decides at load time
    }
    const clean: StageState = { ...entry, id, status };
    delete clean.foreign; // never trust a persisted transient flag
    out[id] = clean;
  }
  return out;
}

/** Extract the machine-managed {@link PersistedState} from a state file body. */
export function parsePersistedState(text: string): PersistedState | undefined {
  const start = text.indexOf(STATE_BEGIN);
  const end = text.indexOf(STATE_END);
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }
  const json = text.slice(start + STATE_BEGIN.length, end).trim();
  try {
    const parsed = JSON.parse(json) as PersistedState;
    if (parsed.version !== 1) {
      return undefined;
    }
    return {
      ...parsed,
      stages: sanitizeStageEntries(parsed.stages),
      units: (parsed.units ?? []).map((u) => ({
        ...u,
        status: normalizeStageStatus(u.status) ?? "not_started",
        stages: sanitizeStageEntries(u.stages),
      })),
    };
  } catch {
    return undefined;
  }
}

/**
 * Keep only stage entries this tracker recorded itself. Foreign-observed
 * statuses (AWS state files, artifact presence) are re-derived on every load;
 * persisting them would freeze a snapshot that masks live foreign progress.
 */
function ownStageEntries(
  stages: Record<string, StageState>
): Record<string, StageState> {
  return Object.fromEntries(
    Object.entries(stages)
      .filter(([, s]) => !s.foreign)
      .map(([id, s]) => {
        const rest: StageState = { ...s };
        delete rest.foreign;
        return [id, rest];
      })
  );
}

export function toPersisted(state: ProjectState): PersistedState {
  return {
    version: 1,
    name: state.name,
    currentPhase: state.currentPhase,
    stages: ownStageEntries(state.stages),
    units: state.units.map((u) => ({ ...u, stages: ownStageEntries(u.stages) })),
    lastSync: state.lastSync,
    jiraEpics: state.jiraEpics,
    runs: state.runs,
    testRuns: state.testRuns,
    extensions: state.extensions,
  };
}

/** Render the full human-readable + machine-managed state file body. */
export function serializeState(state: ProjectState): string {
  const persisted = toPersisted(state);
  const lines: string[] = [];
  lines.push(`# AI-DLC State — ${state.name}`, "");
  lines.push(
    "_This file is managed by the AIDLC Tracker extension. The block at the",
    "bottom is machine-read; edit it only if you know what you are doing._",
    ""
  );
  lines.push(
    `**Current phase:** ${
      phaseById(state.currentPhase)?.name ?? state.currentPhase
    }`,
    ""
  );

  for (const phase of PHASES) {
    lines.push(`## ${phase.name}`, "");
    if (phase.id === "construction") {
      if (state.units.length === 0) {
        lines.push("_No units of work yet._", "");
      }
      for (const unit of state.units) {
        lines.push(
          `- **${unit.title}** — ${STATUS_LABEL[unit.status]}` +
            (unit.jiraKey ? ` ([${unit.jiraKey}])` : "")
        );
      }
      if (state.units.length > 0) {
        lines.push("");
      }
      continue;
    }
    for (const stage of phase.stages) {
      const status = state.stages[stage.id]?.status ?? "not_started";
      const mark = status === "complete" ? "x" : " ";
      lines.push(`- [${mark}] ${stage.name} — ${STATUS_LABEL[status]}`);
    }
    lines.push("");
  }

  lines.push(STATE_BEGIN);
  lines.push(JSON.stringify(persisted, null, 2));
  lines.push(STATE_END);
  lines.push("");
  return lines.join("\n");
}
