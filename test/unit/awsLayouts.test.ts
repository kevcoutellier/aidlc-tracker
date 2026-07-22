import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awsCandidatesForStage,
  chooseDocsRoot,
  discoverUnitIds,
  parseForeignStageProgress,
  unitTitleFromId,
} from "../../src/model/awsLayouts";

// --- artifact candidates ---------------------------------------------------

test("per-unit candidates substitute the unit id in both AWS layouts", () => {
  const paths = awsCandidatesForStage("functional-design", "auth-service").map(
    (c) => c.path
  );
  assert.ok(paths.includes("construction/auth-service/functional-design"));
  assert.ok(paths.includes("construction/functional-design/auth-service"));
});

test("code-generation covers the AWS main plans file", () => {
  const paths = awsCandidatesForStage("code-generation", "billing").map(
    (c) => c.path
  );
  assert.ok(
    paths.includes("construction/plans/billing-code-generation-plan.md")
  );
});

test("without a unit id, unit-scoped candidates are dropped", () => {
  const paths = awsCandidatesForStage("build-test").map((c) => c.path);
  assert.deepEqual(paths, ["construction/build-and-test"]);
});

test("the shared build-and-test dir satisfies every unit", () => {
  const shared = awsCandidatesForStage("build-test", "auth").find(
    (c) => c.shared
  );
  assert.ok(shared);
  assert.equal(shared!.path, "construction/build-and-test");
});

test("unknown stages have no AWS candidates", () => {
  assert.deepEqual(awsCandidatesForStage("nope"), []);
});

// --- unit discovery --------------------------------------------------------

test("main-layout unit dirs are discovered; stage/tooling dirs are not", () => {
  const ids = discoverUnitIds({
    constructionDirs: [
      "auth-service",
      "billing",
      "plans",
      "build-and-test",
      "ci-pipeline",
      "functional-design",
      ".hidden",
    ],
    v2StageChildren: {},
  });
  assert.deepEqual(ids, ["auth-service", "billing"]);
});

test("v2 instance dirs under per-unit stage dirs are discovered and deduped", () => {
  const ids = discoverUnitIds({
    constructionDirs: ["functional-design", "nfr-requirements", "build-and-test"],
    v2StageChildren: {
      "functional-design": ["auth-service", "contributions"],
      "nfr-requirements": ["auth-service", "billing"],
    },
  });
  assert.deepEqual(ids, ["auth-service", "billing"]);
});

test("unit titles humanize kebab and snake ids", () => {
  assert.equal(unitTitleFromId("auth-service"), "Auth Service");
  assert.equal(unitTitleFromId("payment_gateway"), "Payment Gateway");
});

// --- docs root choice ------------------------------------------------------

const FLAT = { rel: "aidlc-docs" };
const RECORD = { rel: "aidlc/spaces/default/intents/fix-a1b2c3d4" };

test("single candidates win by default", () => {
  assert.equal(chooseDocsRoot(undefined, undefined), undefined);
  assert.equal(chooseDocsRoot({ ...FLAT, stateMtime: 10 }, undefined), FLAT.rel);
  assert.equal(chooseDocsRoot(undefined, { ...RECORD, stateMtime: 10 }), RECORD.rel);
});

test("the cursor-designated record beats even a newer flat layout", () => {
  assert.equal(
    chooseDocsRoot(
      { ...FLAT, stateMtime: 999 },
      { ...RECORD, stateMtime: 1, active: true }
    ),
    RECORD.rel
  );
});

test("a record always beats a flat dir that has no state file", () => {
  // The migrated aidlc-docs/ source keeps artifacts but its state moved on.
  assert.equal(
    chooseDocsRoot({ rel: "aidlc-docs" }, { ...RECORD, stateMtime: 1 }),
    RECORD.rel
  );
});

test("otherwise the freshest state file wins, ties going to flat", () => {
  assert.equal(
    chooseDocsRoot({ ...FLAT, stateMtime: 5 }, { ...RECORD, stateMtime: 9 }),
    RECORD.rel
  );
  assert.equal(
    chooseDocsRoot({ ...FLAT, stateMtime: 9 }, { ...RECORD, stateMtime: 5 }),
    FLAT.rel
  );
  assert.equal(
    chooseDocsRoot({ ...FLAT, stateMtime: 7 }, { ...RECORD, stateMtime: 7 }),
    FLAT.rel
  );
});

// --- foreign state parsing -------------------------------------------------

const V2_STATE = `# AI-DLC State Tracking

## Project Information
- **Project**: Demo

## Stage Progress
<!-- Checkbox states: [ ] pending, [-] in-progress, [?] awaiting approval, [R] revising, [x] completed, [S] skipped -->

### INITIALIZATION PHASE
- [x] workspace-scaffold — [EXECUTE]
- [x] workspace-detection — [EXECUTE]

### INCEPTION PHASE
- [x] reverse-engineering — [EXECUTE: brownfield]
- [x] requirements-analysis — [EXECUTE]
- [-] user-stories — [EXECUTE]
- [?] application-design — [EXECUTE]
- [ ] units-generation — [EXECUTE]
- [S] delivery-planning — [SKIP: out of scope]

### CONSTRUCTION PHASE
- [R] functional-design — [EXECUTE]
- [ ] build-and-test — [EXECUTE]

## Current Status
- [x] deployment-execution
`;

test("v2 checkbox marks map to tracker statuses", () => {
  const map = parseForeignStageProgress(V2_STATE);
  assert.equal(map.get("workspace-detection"), "complete");
  assert.equal(map.get("reverse-engineering"), "complete");
  assert.equal(map.get("requirements-analysis"), "complete");
  assert.equal(map.get("user-stories"), "in_progress");
  assert.equal(map.get("application-design"), "awaiting_approval");
  assert.equal(map.get("functional-design"), "in_progress");
  assert.equal(map.get("build-test"), "not_started");
});

test("skipped stages carry no signal and unknown slugs are ignored", () => {
  const map = parseForeignStageProgress(V2_STATE);
  // delivery-planning is [S]; units-generation [ ] is the only signal left.
  assert.equal(map.get("workflow-planning"), "not_started");
  // workspace-scaffold has no tracker equivalent.
  assert.equal([...map.keys()].includes("workspace-scaffold"), false);
});

test("checkbox lines outside the Stage Progress section are ignored", () => {
  const map = parseForeignStageProgress(V2_STATE);
  assert.equal(map.get("deployment"), undefined);
});

test("AWS main style: title-case names, numbering, and rank merging", () => {
  const map = parseForeignStageProgress(`# AI-DLC State

## Stage Progress
- [x] 1. Requirements Analysis
- [x] Story Generation
- [ ] User Stories
- [x] Unit of Work
- [-] Delivery Planning
`);
  assert.equal(map.get("requirements-analysis"), "complete");
  // Two foreign stages map to user-stories; the most advanced wins.
  assert.equal(map.get("user-stories"), "complete");
  assert.equal(map.get("workflow-planning"), "complete");
});

test("a file without a Stage Progress heading is scanned tolerantly", () => {
  const map = parseForeignStageProgress(
    "- [x] requirements-analysis\n- [-] code-generation\n"
  );
  assert.equal(map.get("requirements-analysis"), "complete");
  assert.equal(map.get("code-generation"), "in_progress");
});
