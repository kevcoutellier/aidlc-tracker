import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSIONS,
  directivesFor,
  enabledExtensionNames,
} from "../../src/model/extensions";
import { formatAuditEntry } from "../../src/core/auditFormat";

test("registry mirrors the three AWS extensions with unique ids", () => {
  const ids = EXTENSIONS.map((e) => e.id);
  assert.deepEqual(ids, [
    "security-baseline",
    "resiliency-baseline",
    "property-based-testing",
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test("directivesFor returns only enabled + stage-matching directives", () => {
  const enabled = { "security-baseline": true, "property-based-testing": true };
  // nfr-design: security applies, PBT does not, resiliency disabled.
  const nfr = directivesFor("nfr-design", enabled);
  assert.equal(nfr.length, 1);
  assert.match(nfr[0], /SECURITY-01/);
  // code-generation: security + PBT both apply.
  assert.equal(directivesFor("code-generation", enabled).length, 2);
  // workspace-detection: none apply.
  assert.deepEqual(directivesFor("workspace-detection", enabled), []);
  // nothing enabled.
  assert.deepEqual(directivesFor("code-generation", undefined), []);
});

test("enabledExtensionNames keeps registry order", () => {
  assert.deepEqual(
    enabledExtensionNames({
      "property-based-testing": true,
      "security-baseline": true,
    }),
    ["Security Baseline", "Property-Based Testing"]
  );
  assert.deepEqual(enabledExtensionNames(undefined), []);
});

test("formatAuditEntry renders timestamp, fields, and raw input verbatim", () => {
  const entry = formatAuditEntry(
    "2026-07-07T14:00:00.000Z",
    "stage.request_changes",
    { stage: "Functional Design", unit: "num-10", skipped: undefined },
    "line one\nline two"
  );
  assert.match(entry, /^## 2026-07-07T14:00:00\.000Z — stage\.request_changes$/m);
  assert.match(entry, /- \*\*stage\*\*: Functional Design/);
  assert.match(entry, /- \*\*unit\*\*: num-10/);
  assert.doesNotMatch(entry, /skipped/);
  assert.match(entry, /^> line one$/m);
  assert.match(entry, /^> line two$/m);
});
