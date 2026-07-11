import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBAGENT_DIRECTIVE, stripToHeading } from "../../src/orchestrator/prompts";

test("keeps a document that already starts at a heading", () => {
  assert.equal(stripToHeading("# Title\n\nbody"), "# Title\n\nbody");
});

test("drops conversational preamble before the first heading", () => {
  const out = "I have enough grounding. Producing the artifact.\n# Title\nbody";
  assert.equal(stripToHeading(out), "# Title\nbody");
});

test("subagent directive forces artifact paths into every brief", () => {
  // Task subagents receive no conversation context — if the directive stops
  // demanding artifact paths in briefs, delegation silently loses the
  // upstream designs (functional design, NFRs, infrastructure design).
  assert.ok(SUBAGENT_DIRECTIVE.includes("NO context"));
  assert.ok(SUBAGENT_DIRECTIVE.includes("Artifact files on disk"));
  assert.ok(/READ/.test(SUBAGENT_DIRECTIVE));
  assert.ok(SUBAGENT_DIRECTIVE.includes("workspace-relative paths"));
});

test("rejects narration-only output (no heading) with null", () => {
  // Regression: NUM-10 code-plan — a budget-exhausted run streamed only its
  // exploration narration; that must never be written as an artifact.
  const out =
    "I'll ground this plan in the actual repository state before writing it. " +
    "Glob timed out. Let me use direct directory listing.";
  assert.equal(stripToHeading(out), null);
  assert.equal(stripToHeading(""), null);
});
