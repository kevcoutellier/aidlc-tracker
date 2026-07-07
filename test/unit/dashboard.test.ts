import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardModel } from "../../src/model/dashboard";
import { makeState, makeUnit } from "./fixtures";

test("empty state produces a hasProject=false model", () => {
  const model = buildDashboardModel(undefined);
  assert.equal(model.hasProject, false);
  assert.equal(model.phases.length, 0);
  assert.equal(model.overallTotal, 0);
});

test("inception progress counts completed stages", () => {
  const model = buildDashboardModel(makeState());
  const inception = model.phases.find((p) => p.id === "inception")!;
  assert.equal(inception.done, 6);
  assert.equal(inception.total, 6);
  assert.equal(inception.stages.length, 6);
});

test("construction progress counts completed units", () => {
  const state = makeState({
    units: [
      makeUnit("a", "A", "complete"),
      makeUnit("b", "B", "in_progress"),
    ],
  });
  const model = buildDashboardModel(state);
  const construction = model.phases.find((p) => p.id === "construction")!;
  assert.equal(construction.total, 2);
  assert.equal(construction.done, 1);
  assert.equal(construction.units.length, 2);
  assert.equal(construction.units[0].stages.length, 6);
});

test("overall totals aggregate across phases", () => {
  const model = buildDashboardModel(makeState());
  // 6 inception + 2 operations stages + 1 construction unit = 9 tracked items.
  assert.equal(model.overallTotal, 6 + 2 + 1);
  assert.equal(model.overallDone, 6); // inception complete only
});

test("current phase is flagged", () => {
  const model = buildDashboardModel(makeState());
  assert.equal(model.phases.find((p) => p.isCurrent)!.id, "construction");
});

test("empty model carries zeroed console fields", () => {
  const model = buildDashboardModel(undefined);
  assert.deepEqual(model.approvals, []);
  assert.deepEqual(model.running, []);
  assert.equal(model.unitsTotal, 0);
  assert.equal(model.jiraLinked, 0);
});

test("awaiting_approval and in_progress stages surface in the queues", () => {
  const state = makeState({
    units: [makeUnit("auth", "Auth service", "not_started")],
  });
  state.stages["application-design"] = {
    id: "application-design",
    status: "awaiting_approval",
    artifactPath: "inception/application-design.md",
  };
  state.units[0].stages["functional-design"].status = "in_progress";
  const model = buildDashboardModel(state);

  assert.equal(model.approvals.length, 1);
  assert.equal(model.approvals[0].stageId, "application-design");
  assert.equal(model.approvals[0].artifactPath, "inception/application-design.md");

  assert.equal(model.running.length, 1);
  assert.equal(model.running[0].stageId, "functional-design");
  assert.equal(model.running[0].unitTitle, "Auth service");
});

test("unit rows expose per-unit done counts and jira linkage", () => {
  const state = makeState();
  state.units[0].jiraKey = "NUM-10";
  state.units[0].stages["functional-design"].status = "complete";
  const model = buildDashboardModel(state, { jiraBaseUrl: "https://x.atlassian.net" });

  const construction = model.phases.find((p) => p.isConstruction)!;
  assert.equal(construction.units[0].done, 1);
  assert.equal(construction.units[0].total, 6);
  assert.equal(model.jiraLinked, 1);
  assert.equal(model.jiraBaseUrl, "https://x.atlassian.net");
});
