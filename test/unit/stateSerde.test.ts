import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePersistedState,
  serializeState,
  STATE_BEGIN,
} from "../../src/core/stateSerde";
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
