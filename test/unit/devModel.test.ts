import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchPullsToKey,
  parseGitHubRemote,
  prState,
  readyForDoneTransition,
  summarizeChecks,
} from "../../src/integrations/github/devModel";

test("parseGitHubRemote handles https and ssh forms", () => {
  assert.deepEqual(
    parseGitHubRemote("https://github.com/kevcoutellier/aidlc-tracker.git"),
    { owner: "kevcoutellier", name: "aidlc-tracker" }
  );
  assert.deepEqual(
    parseGitHubRemote("git@github.com:kevcoutellier/numina.git"),
    { owner: "kevcoutellier", name: "numina" }
  );
  assert.deepEqual(parseGitHubRemote("https://github.com/o/r"), {
    owner: "o",
    name: "r",
  });
  assert.equal(parseGitHubRemote("https://gitlab.com/o/r.git"), undefined);
});

test("prState maps merged/open/closed", () => {
  assert.equal(prState({ number: 1, state: "open" }), "open");
  assert.equal(
    prState({ number: 2, state: "closed", merged_at: "2026-07-07T00:00:00Z" }),
    "merged"
  );
  assert.equal(prState({ number: 3, state: "closed", merged_at: null }), "closed");
});

test("matchPullsToKey matches title or head branch, case-insensitive", () => {
  const pulls = [
    { number: 1, title: "NUM-12: support email agent" },
    { number: 2, title: "misc", head: { ref: "feature/num-12-hitl" } },
    { number: 3, title: "NUM-120 other unit" },
    { number: 4, title: "unrelated" },
  ];
  const matched = matchPullsToKey(pulls, "NUM-12").map((p) => p.number);
  // Word-bounded: NUM-120 must NOT match NUM-12 (matches drive Jira transitions).
  assert.deepEqual(matched, [1, 2]);
  assert.deepEqual(
    matchPullsToKey(pulls, "NUM-120").map((p) => p.number),
    [3]
  );
  assert.deepEqual(matchPullsToKey(pulls, "NUM-99"), []);
});

test("readyForDoneTransition needs a merged PR and no open PR", () => {
  // No PRs at all: nothing merged, never ready.
  assert.equal(readyForDoneTransition([]), false);
  // Single merged PR: ready.
  assert.equal(readyForDoneTransition([{ state: "merged" }]), true);
  // A story spanning several PRs: the first merge must NOT close the issue
  // while a follow-up PR is still open (e.g. NUM-10 → PRs #63/#65/#67).
  assert.equal(
    readyForDoneTransition([{ state: "merged" }, { state: "open" }]),
    false
  );
  // Follow-up merged too: now ready.
  assert.equal(
    readyForDoneTransition([{ state: "merged" }, { state: "merged" }]),
    true
  );
  // Abandoned (closed-unmerged) PRs don't block, merged one wins.
  assert.equal(
    readyForDoneTransition([{ state: "merged" }, { state: "closed" }]),
    true
  );
  // Only open or only closed PRs: not ready.
  assert.equal(readyForDoneTransition([{ state: "open" }]), false);
  assert.equal(readyForDoneTransition([{ state: "closed" }]), false);
});

test("summarizeChecks folds conclusions", () => {
  assert.equal(summarizeChecks([]), "none");
  assert.equal(summarizeChecks(["success", "success"]), "passing");
  assert.equal(summarizeChecks(["success", null]), "pending");
  assert.equal(summarizeChecks(["success", "failure"]), "failing");
  assert.equal(summarizeChecks(["cancelled"]), "failing");
});
