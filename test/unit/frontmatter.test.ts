import { test } from "node:test";
import assert from "node:assert/strict";
import { firstHeading, parseFrontmatter } from "../../src/core/frontmatter";

test("parses flat scalar frontmatter and returns the body", () => {
  const text = `---
name: code-reviewer
description: Reviews diffs for bugs
model: claude-opus-4-8
---
# Body heading
content`;
  const { data, body } = parseFrontmatter(text);
  assert.equal(data.name, "code-reviewer");
  assert.equal(data.description, "Reviews diffs for bugs");
  assert.equal(data.model, "claude-opus-4-8");
  assert.match(body, /^# Body heading/);
});

test("strips surrounding quotes from values", () => {
  const { data } = parseFrontmatter(`---\nname: "Quoted Name"\n---\n`);
  assert.equal(data.name, "Quoted Name");
});

test("ignores indented (nested) lines rather than misparsing them", () => {
  const text = `---
name: agent
tools:
  - Read
  - Grep
---
body`;
  const { data } = parseFrontmatter(text);
  assert.equal(data.name, "agent");
  assert.equal(data.tools, undefined);
});

test("returns empty data when there is no frontmatter", () => {
  const { data, body } = parseFrontmatter("# Just markdown\n\ntext");
  assert.deepEqual(data, {});
  assert.equal(body, "# Just markdown\n\ntext");
});

test("firstHeading finds the first markdown heading", () => {
  assert.equal(firstHeading("no heading yet\n## Second level\nmore"), "Second level");
  assert.equal(firstHeading("plain text"), undefined);
});
