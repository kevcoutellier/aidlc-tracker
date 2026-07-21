import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeAssets,
  cursorRuleBadge,
  specBadge,
  steeringBadge,
  totalClaudeAssets,
} from "../../src/model/claude";

test("steering badge reflects the Kiro inclusion mode", () => {
  // No frontmatter: Kiro's default is "always" — no badge needed.
  assert.equal(steeringBadge({}), undefined);
  assert.equal(steeringBadge({ inclusion: "always" }), "always");
  assert.equal(steeringBadge({ inclusion: "manual" }), "manual");
  assert.equal(
    steeringBadge({ inclusion: "fileMatch", fileMatchPattern: "src/**/*.ts" }),
    "fileMatch: src/**/*.ts"
  );
  // fileMatch without a pattern still shows the mode.
  assert.equal(steeringBadge({ inclusion: "fileMatch" }), "fileMatch");
});

test("cursor rule badge reflects how the rule is applied", () => {
  assert.equal(cursorRuleBadge({ alwaysApply: "true" }), "always");
  assert.equal(cursorRuleBadge({ globs: "*.tsx" }), "globs: *.tsx");
  // Neither: applied on agent request — no badge.
  assert.equal(cursorRuleBadge({ description: "React rules" }), undefined);
});

test("spec badge lists the documents that exist", () => {
  assert.equal(specBadge([]), undefined);
  assert.equal(
    specBadge(["requirements.md", "design.md", "tasks.md"]),
    "requirements · design · tasks"
  );
  assert.equal(specBadge(["design.md"]), "design");
});

test("totalClaudeAssets counts every harness group", () => {
  const asset = (kind: "agent" | "steering" | "rule" | "spec") => ({
    kind,
    name: "x",
    path: "x",
  });
  const assets: ClaudeAssets = {
    hasClaude: true,
    agents: [asset("agent")],
    commands: [],
    skills: [],
    memory: [],
    settings: [],
    kiroSteering: [asset("steering"), asset("steering")],
    kiroSpecs: [asset("spec")],
    kiroHooks: [],
    kiroSettings: [],
    aidlcRules: [asset("rule")],
    cursorRules: [asset("rule")],
    amazonqRules: [],
    shared: [],
  };
  assert.equal(totalClaudeAssets(assets), 6);
});
