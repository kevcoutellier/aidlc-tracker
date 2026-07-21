import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileObservedStatus,
  reconcileStageStatus,
  rollUpStatus,
} from "../../src/model/status";
import { StageState, StageStatus } from "../../src/model/types";

function states(...statuses: StageStatus[]): Record<string, StageState> {
  const out: Record<string, StageState> = {};
  statuses.forEach((status, i) => {
    out[`s${i}`] = { id: `s${i}`, status };
  });
  return out;
}

test("empty set rolls up to not_started", () => {
  assert.equal(rollUpStatus({}), "not_started");
});

test("all complete rolls up to complete", () => {
  assert.equal(rollUpStatus(states("complete", "complete")), "complete");
});

test("any awaiting_approval wins over blocked/in_progress", () => {
  assert.equal(
    rollUpStatus(states("complete", "awaiting_approval", "blocked")),
    "awaiting_approval"
  );
});

test("blocked wins over in_progress when no approval pending", () => {
  assert.equal(rollUpStatus(states("in_progress", "blocked")), "blocked");
});

test("mixed with progress but no terminal states is in_progress", () => {
  assert.equal(rollUpStatus(states("not_started", "in_progress")), "in_progress");
});

test("all not_started stays not_started", () => {
  assert.equal(rollUpStatus(states("not_started", "not_started")), "not_started");
});

test("reconcile: no record + artifact present => complete", () => {
  assert.equal(reconcileStageStatus(undefined, true), "complete");
});

test("reconcile: no record + no artifact => not_started", () => {
  assert.equal(reconcileStageStatus(undefined, false), "not_started");
});

test("reconcile: an artifact on disk with a lost/reset status => awaiting_approval", () => {
  // The core recovery: not_started or in_progress but the file exists.
  assert.equal(reconcileStageStatus("not_started", true), "awaiting_approval");
  assert.equal(reconcileStageStatus("in_progress", true), "awaiting_approval");
  assert.equal(reconcileStageStatus("blocked", true), "awaiting_approval");
});

test("reconcile: complete stays complete when artifact present", () => {
  assert.equal(reconcileStageStatus("complete", true), "complete");
});

test("reconcile: awaiting_approval stays awaiting_approval", () => {
  assert.equal(reconcileStageStatus("awaiting_approval", true), "awaiting_approval");
});

test("reconcile: without an artifact the recorded status is kept", () => {
  assert.equal(reconcileStageStatus("in_progress", false), "in_progress");
  assert.equal(reconcileStageStatus("blocked", false), "blocked");
  assert.equal(reconcileStageStatus("complete", false), "complete");
});

test("observed: presence upgrades an unstarted foreign stage to complete", () => {
  assert.equal(reconcileObservedStatus(undefined, true), "complete");
  assert.equal(reconcileObservedStatus("not_started", true), "complete");
  assert.equal(reconcileObservedStatus(undefined, false), "not_started");
  assert.equal(reconcileObservedStatus("not_started", false), "not_started");
});

test("observed: foreign statuses are trusted, never coerced to approval", () => {
  // An AWS workflow mid-stage writes files continuously; that is not our gate.
  assert.equal(reconcileObservedStatus("in_progress", true), "in_progress");
  assert.equal(reconcileObservedStatus("awaiting_approval", true), "awaiting_approval");
  // A foreign complete holds even when we cannot see the artifact.
  assert.equal(reconcileObservedStatus("complete", false), "complete");
});
