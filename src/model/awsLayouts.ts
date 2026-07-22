/**
 * Read-only compatibility with the artifact layouts produced by AWS's
 * aidlc-workflows repo (github.com/awslabs/aidlc-workflows), so a project
 * driven by those rules is tracked without any generation by this extension.
 *
 * Two foreign layouts are recognized, in addition to the tracker's native one:
 *
 * - **main (v0.1.x)** — `aidlc-docs/` with one subdirectory per stage
 *   (`inception/requirements/requirements.md`,
 *   `construction/<unit>/functional-design/…`, plans under
 *   `construction/plans/`, shared `construction/build-and-test/`).
 * - **v2** — a per-intent record dir `aidlc/spaces/<space>/intents/<intent>/`
 *   with `<phase>/<stage>/<artifact>.md` paths and an `aidlc-state.md` whose
 *   "## Stage Progress" section carries checkbox stage statuses.
 *
 * Everything here is pure (no vscode imports) so it unit-tests under Node.
 */

import { StageStatus } from "./types";

/** One possible on-disk location for a stage's artifact. */
export interface ArtifactCandidate {
  /** Docs-relative path; `{unit}` is replaced by the unit id when per-unit. */
  path: string;
  /** A single file, or a stage directory holding one or more markdown files. */
  kind: "file" | "dir";
  /** Dir candidates: preferred representative file to open, when present. */
  main?: string;
  /** Per-unit stages: the location is shared by every unit (not unit-scoped). */
  shared?: boolean;
}

/**
 * Foreign locations per tracker stage id, tried after the native path.
 * Ordered AWS main first, then v2 guesses for `for_each` instance dirs.
 */
const AWS_CANDIDATES: Record<string, ArtifactCandidate[]> = {
  "workspace-detection": [
    { path: "initialization/workspace-detection", kind: "dir" },
  ],
  "reverse-engineering": [
    // Same stage-dir path in main and v2.
    { path: "inception/reverse-engineering", kind: "dir", main: "business-overview.md" },
  ],
  "requirements-analysis": [
    { path: "inception/requirements", kind: "dir", main: "requirements.md" },
    { path: "inception/requirements-analysis", kind: "dir", main: "requirements.md" },
  ],
  "user-stories": [
    { path: "inception/user-stories", kind: "dir", main: "stories.md" },
  ],
  "workflow-planning": [
    { path: "inception/application-design/unit-of-work.md", kind: "file" },
    { path: "inception/plans", kind: "dir", main: "execution-plan.md" },
    { path: "inception/units-generation", kind: "dir", main: "unit-of-work.md" },
    { path: "inception/delivery-planning", kind: "dir" },
  ],
  "application-design": [
    { path: "inception/application-design", kind: "dir", main: "application-design.md" },
  ],
  "functional-design": [
    { path: "construction/{unit}/functional-design", kind: "dir", main: "business-logic-model.md" },
    { path: "construction/functional-design/{unit}", kind: "dir", main: "business-logic-model.md" },
  ],
  "nfr-requirements": [
    { path: "construction/{unit}/nfr-requirements", kind: "dir", main: "nfr-requirements.md" },
    { path: "construction/nfr-requirements/{unit}", kind: "dir", main: "nfr-requirements.md" },
  ],
  "nfr-design": [
    { path: "construction/{unit}/nfr-design", kind: "dir", main: "nfr-design-patterns.md" },
    { path: "construction/nfr-design/{unit}", kind: "dir" },
  ],
  "infrastructure-design": [
    { path: "construction/{unit}/infrastructure-design", kind: "dir", main: "infrastructure-design.md" },
    { path: "construction/infrastructure-design/{unit}", kind: "dir" },
  ],
  "code-generation": [
    { path: "construction/plans/{unit}-code-generation-plan.md", kind: "file" },
    { path: "construction/{unit}/code", kind: "dir" },
    { path: "construction/code-generation/{unit}", kind: "dir" },
  ],
  "build-test": [
    { path: "construction/{unit}/build-and-test", kind: "dir" },
    // AWS runs build & test once for the whole project, not per unit.
    { path: "construction/build-and-test", kind: "dir", main: "build-and-test-summary.md", shared: true },
  ],
  deployment: [
    { path: "operation/deployment-execution", kind: "dir" },
    { path: "operation/deployment-pipeline", kind: "dir" },
    { path: "operation/environment-provisioning", kind: "dir" },
  ],
  monitoring: [
    { path: "operation/observability-setup", kind: "dir" },
  ],
};

/** Foreign candidates for a stage, with `{unit}` resolved. */
export function awsCandidatesForStage(
  stageId: string,
  unitId?: string
): ArtifactCandidate[] {
  const list = AWS_CANDIDATES[stageId] ?? [];
  return list
    .filter((c) => unitId !== undefined || !c.path.includes("{unit}"))
    .map((c) =>
      unitId ? { ...c, path: c.path.split("{unit}").join(unitId) } : c
    );
}

/** Markdown files that never count as a stage artifact (v2 running logs). */
export const NON_ARTIFACT_FILES = new Set(["memory.md", "readme.md"]);

/** `construction/` child dirs that are stage/tooling dirs, never units. */
const NON_UNIT_DIRS = new Set([
  "plans",
  "build-and-test",
  "ci-pipeline",
  "shared",
  "code",
  "contributions",
  "verification",
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "code-generation",
]);

/** v2 per-unit construction stage dirs whose children are unit instances. */
export const V2_PER_UNIT_STAGE_DIRS = [
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "code-generation",
];

/**
 * Derive unit-of-work ids from directory listings: AWS main creates one dir
 * per unit under `construction/`; v2 nests instance dirs under each per-unit
 * stage dir. Returns a sorted, de-duplicated list.
 */
export function discoverUnitIds(input: {
  /** Child directory names of `construction/`. */
  constructionDirs: string[];
  /** Per v2 stage slug, the child directory names of `construction/<slug>/`. */
  v2StageChildren: Record<string, string[]>;
}): string[] {
  const ids = new Set<string>();
  const usable = (name: string) =>
    !NON_UNIT_DIRS.has(name.toLowerCase()) && !name.startsWith(".");
  for (const name of input.constructionDirs) {
    if (usable(name)) {
      ids.add(name);
    }
  }
  for (const children of Object.values(input.v2StageChildren)) {
    for (const name of children) {
      if (usable(name)) {
        ids.add(name);
      }
    }
  }
  return [...ids].sort();
}

/** "auth-service" -> "Auth Service" for display of discovered units. */
export function unitTitleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Foreign stage names (slugified) -> tracker stage ids. Covers v2 slugs and
 * the human titles AWS main writes in its state file.
 */
const FOREIGN_STAGE_ALIASES: Record<string, string> = {
  "workspace-detection": "workspace-detection",
  "workspace-analysis": "workspace-detection",
  "reverse-engineering": "reverse-engineering",
  "requirements-analysis": "requirements-analysis",
  requirements: "requirements-analysis",
  "requirements-gathering": "requirements-analysis",
  "user-stories": "user-stories",
  stories: "user-stories",
  "story-generation": "user-stories",
  "units-generation": "workflow-planning",
  "unit-of-work": "workflow-planning",
  "unit-of-work-planning": "workflow-planning",
  "workflow-planning": "workflow-planning",
  "delivery-planning": "workflow-planning",
  "application-design": "application-design",
  "functional-design": "functional-design",
  "nfr-requirements": "nfr-requirements",
  "nfr-design": "nfr-design",
  "infrastructure-design": "infrastructure-design",
  "code-generation": "code-generation",
  "build-and-test": "build-test",
  "build-test": "build-test",
  deployment: "deployment",
  "deployment-execution": "deployment",
  "deployment-pipeline": "deployment",
  "environment-provisioning": "deployment",
  "observability-setup": "monitoring",
  monitoring: "monitoring",
};

/**
 * v2 checkbox marks -> tracker statuses. `[S]` (skipped) carries no signal for
 * the tracker and is dropped.
 */
const MARK_TO_STATUS: Record<string, StageStatus | undefined> = {
  x: "complete",
  X: "complete",
  " ": "not_started",
  "-": "in_progress",
  "?": "awaiting_approval",
  R: "in_progress",
  r: "in_progress",
  S: undefined,
  s: undefined,
};

/** Higher rank wins when several foreign stages map to one tracker stage. */
const STATUS_RANK: Record<StageStatus, number> = {
  not_started: 0,
  in_progress: 1,
  blocked: 1,
  awaiting_approval: 2,
  complete: 3,
};

/**
 * Parse stage checkboxes from a foreign `aidlc-state.md` into tracker stage
 * statuses. Scoped to the "## Stage Progress" section when it exists (v2),
 * otherwise the whole file is scanned tolerantly (main).
 */
export function parseForeignStageProgress(
  text: string
): Map<string, StageStatus> {
  let body = text;
  const heading = /^##\s+Stage Progress\s*$/im.exec(text);
  if (heading) {
    const rest = text.slice(heading.index + heading[0].length);
    const next = /^##\s+/m.exec(rest);
    body = next ? rest.slice(0, next.index) : rest;
  }

  const out = new Map<string, StageStatus>();
  const line = /^[ \t]*[-*][ \t]*\[([^\]])\][ \t]+(.+)$/gm;
  for (const match of body.matchAll(line)) {
    const status = MARK_TO_STATUS[match[1]];
    if (status === undefined) {
      continue;
    }
    // Drop trailing " — EXECUTE: reason" / " - note" annotations.
    const name = match[2].split(/\s+[—–:-]\s+/)[0];
    const stageId = FOREIGN_STAGE_ALIASES[slugifyStageName(name)];
    if (!stageId) {
      continue;
    }
    const prev = out.get(stageId);
    if (prev === undefined || STATUS_RANK[status] > STATUS_RANK[prev]) {
      out.set(stageId, status);
    }
  }
  return out;
}

function slugifyStageName(name: string): string {
  return name
    .replace(/^\s*\d+(\.\d+)*[.)]?\s+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A candidate docs root for {@link chooseDocsRoot}. */
export interface DocsRootCandidate {
  /** Workspace-relative folder. */
  rel: string;
  /** mtime (ms) of its `aidlc-state.md`, or undefined when absent. */
  stateMtime?: number;
  /** Pointed at by the v2 `active-space`/`active-intent` cursors. */
  active?: boolean;
}

/**
 * Pick the effective docs root between the flat layout (`aidlc-docs/`) and a
 * v2 intent record (`aidlc/spaces/<space>/intents/<intent>/`). The v2 engine
 * migrates flat projects into the record and leaves the source dir behind, so
 * a stale `aidlc-docs/` must not shadow the live record: the cursor-designated
 * record wins outright, otherwise the newest state file wins, and a record
 * always beats a flat dir that has no state at all. Ties go to the flat
 * layout (backward compatibility).
 */
export function chooseDocsRoot(
  flat: DocsRootCandidate | undefined,
  record: DocsRootCandidate | undefined
): string | undefined {
  if (!record) {
    return flat?.rel;
  }
  if (!flat) {
    return record.rel;
  }
  if (record.active) {
    return record.rel;
  }
  if (flat.stateMtime === undefined) {
    return record.rel;
  }
  return (record.stateMtime ?? 0) > flat.stateMtime ? record.rel : flat.rel;
}
