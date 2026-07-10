import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JiraClient,
  JiraConfig,
  adf,
  pickDoneTransition,
} from "../../src/integrations/jira/JiraClient";

const config: JiraConfig = {
  baseUrl: "https://example.atlassian.net/",
  email: "me@example.com",
  token: "secret",
  projectKey: "AIDLC",
  epicIssueType: "Epic",
  unitIssueType: "Task",
};

test("adf wraps text into a valid ADF document", () => {
  const doc = adf("first paragraph\n\nsecond paragraph") as {
    type: string;
    version: number;
    content: Array<{ type: string; content: Array<{ text: string }> }>;
  };
  assert.equal(doc.type, "doc");
  assert.equal(doc.version, 1);
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0].content[0].text, "first paragraph");
});

test("adf never emits an empty text node", () => {
  const doc = adf("") as {
    content: Array<{ content: Array<{ text: string }> }>;
  };
  assert.ok(doc.content[0].content[0].text.length >= 1);
});

test("pickDoneTransition selects by status category, not by name", () => {
  const transitions = [
    { id: "11", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
    { id: "31", name: "Terminer", to: { name: "Terminé", statusCategory: { key: "done" } } },
    { id: "41", name: "Close as done", to: { name: "Closed", statusCategory: { key: "done" } } },
  ];
  // First done-category transition wins — works on FR/EN/custom workflows.
  assert.equal(pickDoneTransition(transitions)?.id, "31");
  assert.equal(pickDoneTransition([transitions[0]]), undefined);
  assert.equal(pickDoneTransition([]), undefined);
});

test("baseFields sets project, issue type and an ADF description", () => {
  const client = new JiraClient(config);
  const fields = client.baseFields("Do the thing", "because reasons", "Task") as {
    project: { key: string };
    summary: string;
    issuetype: { name: string };
    description: { type: string };
  };
  assert.equal(fields.project.key, "AIDLC");
  assert.equal(fields.summary, "Do the thing");
  assert.equal(fields.issuetype.name, "Task");
  assert.equal(fields.description.type, "doc");
});
