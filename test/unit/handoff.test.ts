import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchNameFor,
  buildHandoffMarkdown,
  handoffRelPath,
  launchPrompt,
  slugify,
} from "../../src/orchestrator/handoff";

test("slugify kebab-cases, folds accents, caps length", () => {
  assert.equal(slugify("Config-ops du dashboard"), "config-ops-du-dashboard");
  assert.equal(slugify("Éé àè ç ü"), "ee-ae-c-u");
  assert.equal(slugify("  --Weird__ chars!!  "), "weird-chars");
  // Caps at a dash boundary, never mid-word, never trailing dashes.
  const long = slugify(
    "a very long unit of work title that keeps going and going forever"
  );
  assert.ok(long.length <= 40, `too long: ${long}`);
  assert.ok(!long.endsWith("-"));
  assert.ok(!/[^a-z0-9-]/.test(long));
  assert.equal(slugify(""), "");
});

test("branchNameFor uses the Jira key when present", () => {
  assert.equal(
    branchNameFor({ id: "u1", title: "Config ops", jiraKey: "NUM-110" }),
    "feature/NUM-110-config-ops"
  );
  assert.equal(
    branchNameFor({ id: "u1", title: "Config ops" }),
    "feature/config-ops"
  );
  // Falls back to the unit id, then a constant, when the title slugs empty.
  assert.equal(branchNameFor({ id: "unit-7", title: "!!!" }), "feature/unit-7");
  assert.equal(branchNameFor({ id: "???", title: "!!!" }), "feature/unit");
});

test("handoffRelPath nests under the unit's construction folder", () => {
  assert.equal(handoffRelPath("num-110"), "construction/num-110/handoff.md");
});

test("launchPrompt is shell-quote-safe and forward-slashed", () => {
  const prompt = launchPrompt("aidlc-docs\\construction\\u1\\handoff.md");
  assert.ok(prompt.includes("aidlc-docs/construction/u1/handoff.md"));
  // Safe inside double quotes in PowerShell, bash and cmd.
  assert.ok(!/["$`\\]/.test(prompt), `unsafe chars in: ${prompt}`);
});

test("buildHandoffMarkdown carries plan, rules, branch and ticket", () => {
  const md = buildHandoffMarkdown({
    unit: {
      id: "num-110",
      title: "Config ops",
      description: "Operate agent configuration\nsafely.",
      jiraKey: "NUM-110",
    },
    docsPath: "aidlc-docs",
    artifacts: [
      "construction/num-110/code-plan.md",
      "construction/num-110/functional-design.md",
      "inception/application-design.md",
    ],
    branchName: "feature/NUM-110-config-ops",
  });
  // The code plan leads and is marked as the thing to execute.
  const planIdx = md.indexOf("construction/num-110/code-plan.md");
  const designIdx = md.indexOf("construction/num-110/functional-design.md");
  assert.ok(planIdx > 0 && planIdx < designIdx);
  assert.ok(md.includes("**the plan to execute**"));
  // Ticket key drives commits, PR title and tracking.
  assert.ok(md.includes("(NUM-110)"));
  assert.ok(md.includes("feature/NUM-110-config-ops"));
  // Non-negotiables: repo conventions win, no merging, tests required.
  assert.ok(md.includes("take precedence over this brief"));
  assert.ok(md.includes("do NOT merge"));
  assert.ok(md.includes("Write tests"));
  // Description is quoted into the mission.
  assert.ok(md.includes("> Operate agent configuration"));
  // Starts with a heading (artifact contract shared with the orchestrator).
  assert.ok(md.startsWith("# Handoff — Config ops (NUM-110)"));
});

test("buildHandoffMarkdown works without a Jira key or description", () => {
  const md = buildHandoffMarkdown({
    unit: { id: "u1", title: "Standalone unit" },
    docsPath: "aidlc-docs",
    artifacts: ["construction/u1/code-plan.md"],
    branchName: "feature/standalone-unit",
  });
  assert.ok(md.startsWith("# Handoff — Standalone unit"));
  assert.ok(!md.includes("undefined"));
  assert.ok(md.includes("do NOT merge"));
});
