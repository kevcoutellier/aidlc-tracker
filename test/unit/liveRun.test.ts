import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LiveRunView,
  buildDashboardModel,
  clampPct,
  formatMmSs,
  summarizeTools,
} from "../../src/model/dashboard";
import { makeState } from "./fixtures";

test("formatMmSs renders m:ss, clamping negatives", () => {
  assert.equal(formatMmSs(0), "0:00");
  assert.equal(formatMmSs(83_000), "1:23");
  assert.equal(formatMmSs(600_000), "10:00");
  assert.equal(formatMmSs(59_999), "0:59");
  assert.equal(formatMmSs(-5_000), "0:00");
});

test("clampPct is a 0-100 integer and survives bad input", () => {
  assert.equal(clampPct(0, 10), 0);
  assert.equal(clampPct(5, 10), 50);
  assert.equal(clampPct(15, 10), 100);
  assert.equal(clampPct(1, 3), 33);
  assert.equal(clampPct(3, 0), 0);
  assert.equal(clampPct(NaN, 10), 0);
  assert.equal(clampPct(3, Infinity), 0);
});

test("summarizeTools sorts by count and caps entries", () => {
  assert.equal(
    summarizeTools({ Read: 12, Grep: 3, Task: 2 }),
    "Read×12 · Grep×3 · Task×2"
  );
  assert.equal(summarizeTools({ a: 1, b: 2, c: 3, d: 4, e: 5 }, 2), "e×5 · d×4");
  assert.equal(summarizeTools({}), "");
});

test("buildDashboardModel carries the live run through to the webview", () => {
  const live: LiveRunView = {
    stageId: "code-generation",
    stageName: "Code Generation",
    unitId: "auth",
    unitTitle: "Auth service",
    startedAt: 1_000,
    timeoutMs: 600_000,
    maxTurns: 24,
    turns: 3,
    model: "claude-opus-4-8",
    tools: { Read: 4, Task: 1 },
    tasks: [
      { id: "t1", agent: "security-engineer", brief: "audit", startedAt: 2_000 },
    ],
    lastActivity: "Task → security-engineer · audit",
  };
  const model = buildDashboardModel(makeState(), { live });
  assert.deepEqual(model.live, live);
  // And absent when nothing is generating.
  assert.equal(buildDashboardModel(makeState(), {}).live, undefined);
});
