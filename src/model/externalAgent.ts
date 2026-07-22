/**
 * Detection of externally-driven projects and the hand-off prompt for the
 * IDE's own agent. When the AI-DLC workflow runs inside an agent chat (Kiro,
 * Cursor, Amazon Q), the tracker is the console: its internal generator
 * should not fire by accident, and the natural "run" gesture is a prompt
 * pasted into that chat. Pure (no vscode) so it unit-tests under Node.
 */

import { ClaudeAssets } from "./claude";
import { ProjectState, StageState } from "./types";
import { stageById } from "./aidlcDefinition";

/**
 * True when an external agent appears to drive this project: AI-DLC rules
 * installed for an IDE agent (Kiro steering / rule details), or stage
 * statuses observed from outside the tracker's own records (foreign state
 * file or agent-edited checkboxes) showing actual progress.
 */
export function isExternallyDriven(
  state: ProjectState | undefined,
  claude: ClaudeAssets | undefined
): boolean {
  if (
    claude &&
    (claude.aidlcRules.length > 0 || claude.kiroSteering.length > 0)
  ) {
    return true;
  }
  if (!state) {
    return false;
  }
  // Docs living inside a v2 intent record are, by construction, written by
  // the AI-DLC engine — externally driven even before any stage progresses.
  if (state.docsPath.replace(/\\/g, "/").includes("/aidlc/spaces/")) {
    return true;
  }
  const observedProgress = (stages: Record<string, StageState>) =>
    Object.values(stages).some(
      (s) => s.foreign === true && s.status !== "not_started"
    );
  return (
    observedProgress(state.stages) ||
    state.units.some((u) => observedProgress(u.stages))
  );
}

/**
 * Ready-to-paste prompt asking the IDE agent to execute a stage (or, without
 * a stage id, a unit's remaining Construction stages / the next pending
 * stage) under the workspace's AI-DLC rules. Nudges the agent toward the
 * canonical status vocabulary and both state-file sections.
 */
export function kiroRunPrompt(
  stageId: string | undefined,
  unit?: { title: string }
): string {
  const forUnit = unit ? ` for the unit of work "${unit.title}"` : "";
  let goal: string;
  if (stageId) {
    const name = stageById(stageId)?.name ?? stageId;
    goal = `execute the "${name}" stage${forUnit} now`;
  } else if (unit) {
    goal = `execute the remaining Construction stages${forUnit}, one at a time with my approval between stages`;
  } else {
    goal = "execute the next pending stage now";
  }
  return [
    `Using this workspace's AI-DLC workflow rules, ${goal}.`,
    "Read the current progress from aidlc-docs/aidlc-state.md and the existing artifacts under aidlc-docs/ before starting.",
    'When done: write the stage artifacts under aidlc-docs/, set the stage status to "complete" in aidlc-state.md (both the human checklist and the machine block), and append the event to aidlc-docs/audit.md.',
  ].join("\n");
}
