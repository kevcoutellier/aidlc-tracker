import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStageStatus,
  parsePersistedState,
  serializeState,
  STATE_BEGIN,
} from "../../src/core/stateSerde";
import { parseForeignStageProgress } from "../../src/model/awsLayouts";
import { makeState } from "./fixtures";

test("serialize then parse round-trips the persisted state", () => {
  const state = makeState({ lastSync: "2026-07-06T00:00:00.000Z" });
  const text = serializeState(state);
  const parsed = parsePersistedState(text);

  assert.ok(parsed);
  assert.equal(parsed!.version, 1);
  assert.equal(parsed!.name, "demo");
  assert.equal(parsed!.currentPhase, "construction");
  assert.equal(parsed!.units.length, 1);
  assert.equal(parsed!.units[0].id, "auth");
  assert.equal(parsed!.lastSync, "2026-07-06T00:00:00.000Z");
});

test("serialized file contains a human-readable heading and the state block", () => {
  const text = serializeState(makeState());
  assert.match(text, /# AI-DLC State — demo/);
  assert.ok(text.includes(STATE_BEGIN));
});

test("parse returns undefined when the machine block is missing", () => {
  assert.equal(parsePersistedState("# just a doc\n\nno block here"), undefined);
});

test("parse returns undefined for an unsupported version", () => {
  const text = `${STATE_BEGIN}\n{"version": 2}\nAIDLC-STATE:END -->`;
  assert.equal(parsePersistedState(text), undefined);
});

test("foreign-observed stage entries are not persisted", () => {
  const state = makeState();
  state.stages["requirements-analysis"].foreign = true;
  state.units[0].stages["functional-design"].foreign = true;

  const parsed = parsePersistedState(serializeState(state));
  assert.ok(parsed);
  assert.equal(parsed!.stages["requirements-analysis"], undefined);
  assert.ok(parsed!.stages["user-stories"]);
  assert.equal(parsed!.units[0].stages["functional-design"], undefined);
  assert.ok(parsed!.units[0].stages["nfr-design"]);
  // The transient flag itself never reaches the serialized block.
  assert.equal(JSON.stringify(parsed).includes('"foreign"'), false);
});

test("status variants written by external agents are canonicalized", () => {
  assert.equal(normalizeStageStatus("complete"), "complete");
  assert.equal(normalizeStageStatus("completed"), "complete");
  assert.equal(normalizeStageStatus("Done"), "complete");
  assert.equal(normalizeStageStatus("in progress"), "in_progress");
  assert.equal(normalizeStageStatus("In-Progress"), "in_progress");
  assert.equal(normalizeStageStatus("awaiting approval"), "awaiting_approval");
  assert.equal(normalizeStageStatus("pending"), "not_started");
  assert.equal(normalizeStageStatus("blocked"), "blocked");
  assert.equal(normalizeStageStatus("banana"), undefined);
  assert.equal(normalizeStageStatus(42), undefined);
});

test("a block edited by an external agent parses with canonical statuses", () => {
  // Exactly what the AI-DLC rules running in Kiro wrote: "completed".
  const text = `${STATE_BEGIN}
{
  "version": 1,
  "name": "AgentLayers",
  "currentPhase": "inception",
  "stages": {
    "workspace-detection": { "id": "workspace-detection", "status": "completed" },
    "reverse-engineering": { "id": "reverse-engineering", "status": "not_started" },
    "requirements-analysis": { "id": "requirements-analysis", "status": "garbage" }
  },
  "units": [
    { "id": "auth", "title": "Auth", "status": "done",
      "stages": { "functional-design": { "id": "functional-design", "status": "in progress" } } }
  ]
}
AIDLC-STATE:END -->`;
  const parsed = parsePersistedState(text);
  assert.ok(parsed);
  assert.equal(parsed!.stages["workspace-detection"].status, "complete");
  assert.equal(parsed!.stages["reverse-engineering"].status, "not_started");
  // Unrecognizable statuses are dropped, not passed through to the UI.
  assert.equal(parsed!.stages["requirements-analysis"], undefined);
  assert.equal(parsed!.units[0].status, "complete");
  assert.equal(parsed!.units[0].stages["functional-design"].status, "in_progress");
});

test("the native human section parses as observed checkbox statuses", () => {
  // An external agent may tick only the visible list; the parser must read it.
  const text = serializeState(makeState());
  const observed = parseForeignStageProgress(text);
  assert.equal(observed.get("workspace-detection"), "complete");
  assert.equal(observed.get("requirements-analysis"), "complete");
  assert.equal(observed.get("deployment"), "not_started");
  // Unit rows ("- **Auth service** — …") are not checkboxes: never parsed.
  assert.equal([...observed.keys()].length, 8);
});
