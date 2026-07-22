import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExternallyDriven,
  kiroRunPrompt,
} from "../../src/model/externalAgent";
import { ClaudeAssets } from "../../src/model/claude";
import { makeState } from "./fixtures";

function assets(overrides: Partial<ClaudeAssets> = {}): ClaudeAssets {
  return {
    hasClaude: true,
    agents: [],
    commands: [],
    skills: [],
    memory: [],
    settings: [],
    kiroSteering: [],
    kiroSpecs: [],
    kiroHooks: [],
    kiroSettings: [],
    kiroAgents: [],
    aidlcRules: [],
    cursorRules: [],
    amazonqRules: [],
    shared: [],
    ...overrides,
  };
}

test("AI-DLC rules or Kiro steering mark the project externally driven", () => {
  const rule = { kind: "rule" as const, name: "r", path: "r.md" };
  assert.equal(
    isExternallyDriven(undefined, assets({ aidlcRules: [rule] })),
    true
  );
  assert.equal(
    isExternallyDriven(
      undefined,
      assets({ kiroSteering: [{ kind: "steering", name: "s", path: "s.md" }] })
    ),
    true
  );
  assert.equal(isExternallyDriven(undefined, assets()), false);
});

test("docs living inside a v2 intent record mark the project externally driven", () => {
  const state = makeState({
    docsPath: "C:\\proj\\aidlc\\spaces\\default\\intents\\fix-sort-a1b2c3d4",
  });
  assert.equal(isExternallyDriven(state, undefined), true);
  assert.equal(
    isExternallyDriven(
      makeState({ docsPath: "/proj/aidlc/spaces/team/intents/x" }),
      undefined
    ),
    true
  );
  // The flat native layout carries no such signal by itself.
  assert.equal(isExternallyDriven(makeState(), undefined), false);
});

test("foreign-observed stage progress marks the project externally driven", () => {
  const state = makeState();
  assert.equal(isExternallyDriven(state, undefined), false);

  state.stages["requirements-analysis"].foreign = true;
  assert.equal(isExternallyDriven(state, undefined), true);

  // A foreign not_started carries no signal of external activity.
  state.stages["requirements-analysis"].foreign = false;
  state.stages["deployment"].foreign = true; // not_started in the fixture
  assert.equal(isExternallyDriven(state, undefined), false);

  state.units[0].stages["functional-design"].foreign = true; // in_progress
  assert.equal(isExternallyDriven(state, undefined), true);
});

test("kiro prompt names the stage, the unit, and the state contract", () => {
  const p = kiroRunPrompt("functional-design", { title: "Agent Directory Sort" });
  assert.match(p, /"Functional Design" stage for the unit of work "Agent Directory Sort"/);
  assert.match(p, /aidlc-docs\/aidlc-state\.md/);
  assert.match(p, /"complete"/);
  assert.match(p, /audit\.md/);
});

test("kiro prompt covers pipeline and next-stage phrasings", () => {
  assert.match(
    kiroRunPrompt(undefined, { title: "Auth" }),
    /remaining Construction stages for the unit of work "Auth"/
  );
  assert.match(kiroRunPrompt(undefined), /next pending stage/);
  // Unknown stage ids fall back to the raw id rather than crashing.
  assert.match(kiroRunPrompt("mystery-stage"), /"mystery-stage" stage/);
});
