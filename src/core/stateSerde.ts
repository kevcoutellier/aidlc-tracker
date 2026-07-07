/**
 * Pure (vscode-free) serialization for the AI-DLC state file. Kept separate from
 * {@link ./StateWriter} so it can be unit-tested under plain Node.
 */

import { PersistedState, ProjectState, StageStatus } from "../model/types";
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
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function toPersisted(state: ProjectState): PersistedState {
  return {
    version: 1,
    name: state.name,
    currentPhase: state.currentPhase,
    stages: state.stages,
    units: state.units,
    lastSync: state.lastSync,
    jiraEpics: state.jiraEpics,
    runs: state.runs,
    testRuns: state.testRuns,
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
