import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_STAGES,
  PHASES,
  artifactPath,
  stageById,
  unitStages,
} from "../../src/model/aidlcDefinition";

test("there are exactly three phases in order", () => {
  assert.deepEqual(
    PHASES.map((p) => p.id),
    ["inception", "construction", "operations"]
  );
});

test("inception has six stages, construction six per-unit, operations two", () => {
  const byPhase = (id: string) => PHASES.find((p) => p.id === id)!.stages;
  assert.equal(byPhase("inception").length, 6);
  assert.equal(byPhase("construction").length, 6);
  assert.ok(byPhase("construction").every((s) => s.perUnit));
  assert.equal(byPhase("operations").length, 2);
  assert.equal(unitStages().length, 6);
});

test("all stage ids are unique", () => {
  const ids = ALL_STAGES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("per-unit artifact paths interpolate the unit id", () => {
  const stage = stageById("functional-design")!;
  assert.equal(
    artifactPath(stage, "auth-service"),
    "construction/auth-service/functional-design.md"
  );
});

test("project-level artifact paths do not contain the unit token", () => {
  const stage = stageById("requirements-analysis")!;
  assert.equal(artifactPath(stage), "inception/requirements.md");
});
