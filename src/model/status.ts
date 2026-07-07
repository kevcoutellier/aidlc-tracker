import { StageState, StageStatus } from "./types";

/**
 * Reconcile a stage's persisted status with whether its artifact exists on disk.
 * An artifact on disk with a non-terminal status means a generated artifact is
 * waiting for approval (a lost transition or a reset stale run) — surface it for
 * approval rather than as a spinner or a "not started" circle.
 */
export function reconcileStageStatus(
  recorded: StageStatus | undefined,
  present: boolean
): StageStatus {
  if (recorded === undefined) {
    return present ? "complete" : "not_started";
  }
  if (present && recorded !== "complete" && recorded !== "awaiting_approval") {
    return "awaiting_approval";
  }
  return recorded;
}

/** Derive an aggregate status from a set of stage states (e.g. a unit's). */
export function rollUpStatus(
  stages: Record<string, StageState>
): StageStatus {
  const values = Object.values(stages);
  if (values.length === 0) {
    return "not_started";
  }
  if (values.every((s) => s.status === "complete")) {
    return "complete";
  }
  if (values.some((s) => s.status === "awaiting_approval")) {
    return "awaiting_approval";
  }
  if (values.some((s) => s.status === "blocked")) {
    return "blocked";
  }
  if (values.some((s) => s.status !== "not_started")) {
    return "in_progress";
  }
  return "not_started";
}
