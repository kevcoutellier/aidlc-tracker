import * as vscode from "vscode";
import { ProjectState, StageState } from "../model/types";
import { projectLevelStages } from "../model/aidlcDefinition";
import {
  docsUri,
  refreshDocsFolderDetection,
  stateUri,
  workspaceRoot,
} from "../core/paths";
import { ensureDir, exists, readText, writeIfAbsent } from "../core/fsUtil";
import { resolveStateUri, StateWriter } from "../core/StateWriter";
import { STATE_BEGIN } from "../core/stateSerde";

const README = `# AI-DLC Docs

This folder is managed by the **AIDLC Tracker** VS Code extension. It holds the
working artifacts of the AI-Driven Development Life Cycle for this project.

## Layout

- \`aidlc-state.md\` — tracked progress (source of truth for the extension).
- \`inception/\` — requirements, user stories, workflow plan, application design.
- \`construction/<unit-id>/\` — per-unit design, code plan, and build/test notes.
- \`operations/\` — deployment and monitoring (placeholder).
- \`rules/\` — methodology rule files used to steer generation.

Open the **AIDLC** view in the activity bar to drive the lifecycle.
`;

const RULES_OVERVIEW = `# AI-DLC Rules — Overview

The AI-Driven Development Life Cycle runs in three phases:

1. **Inception** — establish WHAT to build and WHY. Produces workspace analysis,
   reverse-engineering notes, requirements, user stories, a workflow plan, and a
   high-level application design.
2. **Construction** — establish HOW to build it, one *unit of work* at a time:
   functional design → NFR requirements → NFR design → infrastructure design →
   code generation (plan, then execute) → build & test.
3. **Operations** — deploy, monitor, maintain.

Every generated artifact is reviewed and approved by a human before it is
committed. Code generation is plan-then-execute: writing code requires a second,
explicit approval.
`;

/**
 * Creates the AI-DLC docs folder structure, initial state file, and rule files.
 * Idempotent: existing files are left untouched. Returns the fresh state.
 */
export async function initProject(): Promise<ProjectState> {
  await refreshDocsFolderDetection();
  const root = workspaceRoot();
  const docs = docsUri(root);
  if (!root || !docs) {
    throw new Error("Open a folder before initializing an AI-DLC project.");
  }

  // Docs already produced by AWS aidlc-workflows: track them in place, do not
  // scaffold our folder structure or rule files into the foreign layout.
  const primary = stateUri();
  const foreign =
    primary !== undefined &&
    (await exists(primary)) &&
    !(await readText(primary)).includes(STATE_BEGIN);

  if (!foreign) {
    await ensureDir(docs);
    await ensureDir(vscode.Uri.joinPath(docs, "inception"));
    await ensureDir(vscode.Uri.joinPath(docs, "construction"));
    await ensureDir(vscode.Uri.joinPath(docs, "operations"));
    await ensureDir(vscode.Uri.joinPath(docs, "rules"));

    await writeIfAbsent(vscode.Uri.joinPath(docs, "README.md"), README);
    await writeIfAbsent(
      vscode.Uri.joinPath(docs, "rules", "aidlc-overview.md"),
      RULES_OVERVIEW
    );
  }

  const stages: Record<string, StageState> = {};
  for (const stage of projectLevelStages()) {
    stages[stage.id] = { id: stage.id, status: "not_started" };
  }

  const state: ProjectState = {
    name: root.name,
    rootPath: root.uri.fsPath,
    docsPath: docs.fsPath,
    currentPhase: "inception",
    stages,
    units: [],
    artifacts: [],
  };

  // Never clobber an existing tracked state — re-running init on a project that
  // already has AI-DLC progress must preserve it. resolveStateUri points at the
  // tracker-owned file when aidlc-state.md is foreign.
  const target = await resolveStateUri();
  if (!target || !(await exists(target))) {
    await new StateWriter().save(state);
  }
  return state;
}
