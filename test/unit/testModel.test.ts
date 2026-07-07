import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTestOutput, testRunOk } from "../../src/testing/testModel";

test("parses node:test TAP summaries", () => {
  const out = "TAP version 13\n# tests 41\n# suites 0\n# pass 40\n# fail 1\n# skipped 0";
  assert.deepEqual(parseTestOutput(out), {
    total: 41,
    passed: 40,
    failed: 1,
    skipped: 0,
  });
});

test("parses jest summaries", () => {
  const out = "Tests:       1 failed, 2 skipped, 5 passed, 8 total\nTime: 3.2s";
  const s = parseTestOutput(out);
  assert.equal(s.total, 8);
  assert.equal(s.failed, 1);
  assert.equal(s.skipped, 2);
  assert.equal(s.passed, 5);
});

test("parses vitest summaries", () => {
  const s = parseTestOutput("Test Files  2 passed (2)\n     Tests  3 failed | 42 passed (45)");
  assert.equal(s.total, 45);
  assert.equal(s.failed, 3);
  assert.equal(s.passed, 42);
});

test("parses pytest summaries", () => {
  const s = parseTestOutput("========= 5 passed, 1 failed, 2 skipped in 1.23s =========");
  assert.equal(s.total, 8);
  assert.equal(s.passed, 5);
  assert.equal(s.failed, 1);
  assert.equal(s.skipped, 2);
});

test("parses mocha summaries", () => {
  const s = parseTestOutput("  12 passing (340ms)\n  2 failing\n  1 pending");
  assert.equal(s.total, 15);
  assert.equal(s.passed, 12);
  assert.equal(s.failed, 2);
  assert.equal(s.skipped, 1);
});

test("extracts istanbul coverage", () => {
  const s = parseTestOutput("# tests 5\n# pass 5\nAll files      |   85.3 |    70.1 |");
  assert.equal(s.coveragePct, 85.3);
});

test("empty output parses to nothing", () => {
  assert.deepEqual(parseTestOutput("no summary here"), {});
});

test("testRunOk: exit 0 wins; else zero failures with a summary", () => {
  assert.equal(testRunOk(0, {}), true);
  assert.equal(testRunOk(1, {}), false);
  assert.equal(testRunOk(1, { total: 5, failed: 0 }), true);
  assert.equal(testRunOk(1, { total: 5, failed: 2 }), false);
});
