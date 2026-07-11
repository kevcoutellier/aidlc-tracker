import * as vscode from "vscode";
import {
  AidlcServices,
  SECRET_ANTHROPIC_AUTH_TOKEN,
  SECRET_ANTHROPIC_KEY,
  SECRET_CLAUDE_CODE_TOKEN,
  SECRET_JIRA_TOKEN,
} from "../services";
import { initProject } from "../orchestrator/scaffolder";
import {
  branchNameFor,
  buildHandoffMarkdown,
  handoffRelPath,
  launchPrompt,
} from "../orchestrator/handoff";
import { artifactPath, stageById, unitStages } from "../model/aidlcDefinition";
import { rollUpStatus } from "../model/status";
import { StageState, UnitOfWork } from "../model/types";
import { docsChildUri, workspaceRoot } from "../core/paths";
import { exists } from "../core/fsUtil";
import { DashboardPanel } from "../views/DashboardPanel";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { TestRunner } from "../testing/TestRunner";
import { EXTENSIONS } from "../model/extensions";
import { AnthropicClient } from "../orchestrator/AnthropicClient";
import { createJiraSync } from "../integrations/jira/JiraSync";
import { readyForDoneTransition } from "../integrations/github/devModel";
import { TrackerSync } from "../integrations/TrackerSync";

/** A tree node argument carrying a stage/unit reference (from inline actions). */
interface StageArg {
  stageId?: string;
  unitId?: string;
}

function stageRef(arg: unknown): StageArg {
  if (arg && typeof arg === "object" && "stageId" in arg) {
    const a = arg as StageArg;
    return { stageId: a.stageId, unitId: a.unitId };
  }
  return {};
}

/** Registers every contributed command. */
export function registerCommands(
  services: AidlcServices,
  orchestrator: Orchestrator
): void {
  const { context } = services;

  const register = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register("aidlc.initProject", () => runInit(services));
  register("aidlc.refresh", () => refreshAll(services));
  register("aidlc.openArtifact", (relativePath: string) =>
    openArtifact(relativePath)
  );
  register("aidlc.openClaudeAsset", (relativePath: string) =>
    openWorkspaceFile(relativePath)
  );
  register("aidlc.addUnitOfWork", () => addUnitOfWork(services));
  register("aidlc.openDashboard", () => DashboardPanel.createOrShow(services));

  register("aidlc.runNextStage", () => orchestrator.runNextStage());
  register("aidlc.runStage", (arg: unknown) => {
    const { stageId, unitId } = stageRef(arg);
    if (stageId) {
      void orchestrator.runStage(stageId, unitId);
    }
  });
  register("aidlc.approveArtifact", (arg: unknown) => {
    const { stageId, unitId } = stageRef(arg);
    if (stageId) {
      void orchestrator.approve(stageId, unitId);
    }
  });
  register("aidlc.requestChanges", (arg: unknown) => {
    const { stageId, unitId } = stageRef(arg);
    if (stageId) {
      void orchestrator.requestChanges(stageId, unitId);
    }
  });
  register("aidlc.resetStage", (arg: unknown) => {
    const { stageId, unitId } = stageRef(arg);
    if (stageId) {
      void resetStage(services, stageId, unitId);
    }
  });
  register("aidlc.runUnitPipeline", async (arg: unknown) => {
    let unitId =
      arg && typeof arg === "object" && "unitId" in arg
        ? (arg as { unitId?: string }).unitId
        : undefined;
    if (!unitId) {
      const units = (services.store.state?.units ?? []).filter(
        (u) => u.status !== "complete"
      );
      const pick = await vscode.window.showQuickPick(
        units.map((u) => ({
          label: u.title,
          description: u.jiraKey,
          id: u.id,
        })),
        { title: "Run Unit Pipeline (auto-approve)", placeHolder: "Pick a unit of work" }
      );
      unitId = pick?.id;
    }
    if (unitId) {
      void orchestrator.runUnitPipeline(unitId);
    }
  });
  register("aidlc.handoffUnit", (arg: unknown) => handoffUnit(services, arg));
  register("aidlc.cancelGeneration", () => orchestrator.cancelCurrent());
  register("aidlc.setAnthropicKey", () => setAnthropicKey(services));
  register("aidlc.setAnthropicToken", () => setAnthropicToken(services));
  register("aidlc.setClaudeCodeToken", () => setClaudeCodeToken(services));

  register("aidlc.syncToJira", () => syncJira(services, "push"));
  register("aidlc.pullFromJira", () => syncJira(services, "pull"));
  register("aidlc.pullStoriesFromJira", () => importFromJira(services, "stories"));
  register("aidlc.pullRequirementsFromJira", () =>
    importFromJira(services, "requirements")
  );
  register("aidlc.importUnitsFromJira", () => importUnitsFromJira(services));
  register("aidlc.refreshDevActivity", (interactive?: unknown) =>
    refreshDevActivity(services, interactive !== false)
  );
  const testRunner = new TestRunner(services);
  register("aidlc.runTests", () => testRunner.run());
  register("aidlc.configureExtensions", () => configureExtensions(services));
  register("aidlc.openAuditLog", () => openArtifact("audit.md"));
  register("aidlc.openExternalGitHub", (url: unknown) => {
    if (typeof url === "string" && /^https:\/\/github\.com\//.test(url)) {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  });
  register("aidlc.openJiraIssue", (key: unknown) => {
    const baseUrl = vscode.workspace
      .getConfiguration("aidlc")
      .get<string>("jira.baseUrl", "")
      .replace(/\/+$/, "");
    if (baseUrl && typeof key === "string" && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) {
      void vscode.env.openExternal(vscode.Uri.parse(`${baseUrl}/browse/${key}`));
    }
  });
  register("aidlc.setJiraCredentials", () => setJiraCredentials(services));
  register("aidlc.connectJira", () => connectJira(services));
  register("aidlc.jiraMenu", () => jiraMenu(services));
}

async function refreshAll(services: AidlcServices): Promise<void> {
  await Promise.all([
    services.reload(),
    services.reloadClaude(),
    services.refreshJiraStatus(),
    refreshDevActivity(services, false),
  ]);
}

/**
 * One passive-monitoring tick: refresh dev activity and pull Jira statuses,
 * silently (no prompts, no toasts) — the views update through their stores.
 */
export async function monitorTick(services: AidlcServices): Promise<void> {
  await refreshDevActivity(services, false).catch(() => undefined);
  const { context, store, writer, reload } = services;
  if (
    !store.state ||
    store.state.units.length === 0 ||
    !vscode.workspace.getConfiguration("aidlc").get<boolean>("monitor.pullJira", true)
  ) {
    return;
  }
  try {
    const sync = await createJiraSync(context);
    if (await sync.isConfigured()) {
      await sync.pull(store.state);
      await writer.save(store.state);
      await reload();
    }
  } catch {
    /* silent by design — next tick retries */
  }
}

/** Collect commits/branches/PRs for the tracked units into the dev store. */
export async function refreshDevActivity(
  services: AidlcServices,
  interactive: boolean
): Promise<void> {
  const units = services.store.state?.units ?? [];
  if (units.length === 0) {
    return;
  }
  const activity = await services.devService.collect(units, interactive);
  services.devStore.set(activity);
  if (interactive && activity.error) {
    void vscode.window.showWarningMessage(`Dev activity: ${activity.error}`);
  }
  await autoTransitionMergedUnits(services).catch(() => undefined);
}

/**
 * Issues already handled this session (transitioned, already done, or failed) —
 * prevents re-hitting Jira every monitoring tick for the same merged PR.
 */
const transitionHandled = new Set<string>();

/**
 * Auto-transition: a unit moves its Jira issue to the "done" status category
 * only once its PRs are settled — at least one merged AND none still open (a
 * story often spans several PRs; the first merge must not close the issue).
 * Gated by `aidlc.jira.autoTransition`; word-bounded PR↔key matching upstream
 * ensures NUM-12 never closes on NUM-120's PR.
 */
async function autoTransitionMergedUnits(
  services: AidlcServices
): Promise<void> {
  const { context, store, writer, reload, audit } = services;
  const cfg = vscode.workspace.getConfiguration("aidlc");
  if (!cfg.get<boolean>("jira.autoTransition", true)) {
    return;
  }
  const state = store.state;
  const dev = services.devStore.activity;
  if (!state || !dev) {
    return;
  }
  const candidates = state.units.filter(
    (u) =>
      u.jiraKey &&
      !transitionHandled.has(u.jiraKey) &&
      readyForDoneTransition(dev.byUnit[u.id]?.prs ?? [])
  );
  if (candidates.length === 0) {
    return;
  }
  const sync = await createJiraSync(context);
  if (!(await sync.isConfigured())) {
    return;
  }

  const moved: string[] = [];
  for (const unit of candidates) {
    const key = unit.jiraKey!;
    transitionHandled.add(key);
    try {
      const res = await sync.transitionToDone(key);
      if (res.outcome === "transitioned") {
        moved.push(key);
        unit.jiraStatus = res.statusName ?? "Done";
        void audit.append("jira.transition", {
          issue: key,
          unit: unit.id,
          to: res.statusName,
          reason: "all PRs settled, at least one merged",
        });
      } else if (res.outcome === "no-done-transition") {
        void audit.append("jira.transition.error", {
          issue: key,
          error: "no transition to a done-category status available",
        });
      }
    } catch (err) {
      void audit.append("jira.transition.error", {
        issue: key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (moved.length > 0) {
    await writer.save(state);
    await reload();
    void vscode.window.showInformationMessage(
      `Jira: ${moved.join(", ")} → Done (merged PR${moved.length > 1 ? "s" : ""}).`
    );
  }
}

/**
 * Bridge from an approved code plan to an implementation session: write a
 * committed handoff brief (`construction/<unit>/handoff.md`) and offer to
 * launch Claude Code on it. The plugin never writes source code — the session
 * implements under the repository's own conventions and gates, and the
 * dashboard then tracks the resulting branch/PRs/checks by the unit's Jira
 * key until auto-transition closes the loop.
 */
async function handoffUnit(
  services: AidlcServices,
  arg: unknown
): Promise<void> {
  const { store, writer, audit, reload } = services;
  const state = store.state;
  if (!state) {
    void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
    return;
  }

  let unitId =
    arg && typeof arg === "object" && "unitId" in arg
      ? (arg as { unitId?: string }).unitId
      : undefined;
  if (!unitId) {
    const ready = state.units.filter(
      (u) => u.stages["code-generation"]?.status === "complete"
    );
    if (ready.length === 0) {
      void vscode.window.showInformationMessage(
        "No unit has an approved code plan yet — run and approve Code Generation first."
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      ready.map((u) => ({ label: u.title, description: u.jiraKey, id: u.id })),
      {
        title: "Hand Off to Claude Code",
        placeHolder: "Pick a unit with an approved code plan",
      }
    );
    unitId = pick?.id;
  }
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) {
    return;
  }
  if (unit.stages["code-generation"]?.status !== "complete") {
    void vscode.window.showWarningMessage(
      `Approve the code plan for "${unit.title}" first — the handoff brief is built from it.`
    );
    return;
  }

  // Artifacts in read order: the code plan first, then the unit's other
  // completed designs, then the project-level application design.
  const codePlanRel =
    unit.stages["code-generation"]?.artifactPath ??
    artifactPath(stageById("code-generation")!, unit.id)!;
  const candidates = [codePlanRel];
  for (const s of unitStages()) {
    if (s.id === "code-generation") {
      continue;
    }
    const st = unit.stages[s.id];
    const rel = st?.artifactPath ?? artifactPath(s, unit.id);
    if (rel && st?.status === "complete") {
      candidates.push(rel);
    }
  }
  candidates.push("inception/application-design.md");
  const artifacts: string[] = [];
  for (const rel of candidates) {
    const uri = docsChildUri(rel);
    if (uri && (await exists(uri))) {
      artifacts.push(rel);
    }
  }
  if (artifacts[0] !== codePlanRel) {
    void vscode.window.showErrorMessage(
      `The approved code plan is missing on disk (${codePlanRel}). Re-run Code Generation.`
    );
    return;
  }

  const docsPath = vscode.workspace
    .getConfiguration("aidlc")
    .get<string>("docsPath", "aidlc-docs");
  const branchName = branchNameFor(unit);
  const rel = handoffRelPath(unit.id);
  await writer.writeArtifact(
    rel,
    buildHandoffMarkdown({ unit, docsPath, artifacts, branchName })
  );
  await reload();
  void audit.append("unit.handoff", {
    unit: unit.id,
    key: unit.jiraKey,
    artifact: rel,
    branch: branchName,
  });

  const prompt = launchPrompt(`${docsPath}/${rel}`);
  const pick = await vscode.window.showInformationMessage(
    `Handoff brief written for "${unit.title}". Launch a Claude Code session on it?`,
    "Launch Claude Code",
    "Copy Prompt",
    "Open Brief"
  );
  if (pick === "Launch Claude Code") {
    const term = vscode.window.createTerminal({
      name: `Claude Code · ${unit.jiraKey ?? unit.title}`,
      cwd: workspaceRoot()?.uri.fsPath,
    });
    term.show();
    // Quote-safe by construction: launchPrompt emits no ", $, ` or backslash.
    term.sendText(`claude "${prompt}"`, true);
    void audit.append("unit.handoff.launch", {
      unit: unit.id,
      key: unit.jiraKey,
    });
  } else if (pick === "Copy Prompt") {
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      "Handoff prompt copied — paste it into any Claude Code session opened at the repository root."
    );
  } else if (pick === "Open Brief") {
    const uri = docsChildUri(rel);
    if (uri) {
      await vscode.window.showTextDocument(uri, { preview: true });
    }
  }
}

/** Toggle the opt-in AI-DLC extensions (security/resiliency/PBT baselines). */
async function configureExtensions(services: AidlcServices): Promise<void> {
  const { store, writer, reload, audit } = services;
  if (!store.state) {
    void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
    return;
  }
  const current = store.state.extensions ?? {};
  const picks = await vscode.window.showQuickPick(
    EXTENSIONS.map((e) => ({
      label: e.name,
      description: e.id,
      detail: e.description,
      picked: !!current[e.id],
      id: e.id,
    })),
    {
      title: "AI-DLC Extensions",
      placeHolder:
        "Enabled extensions inject their rules into matching stages and require a compliance section per artifact.",
      canPickMany: true,
    }
  );
  if (!picks) {
    return;
  }
  const enabled: Record<string, boolean> = {};
  for (const e of EXTENSIONS) {
    enabled[e.id] = picks.some((p) => p.id === e.id);
  }
  store.update((s) => {
    s.extensions = enabled;
  });
  await writer.save(store.state);

  // Self-documenting rules folder, mirroring the AWS delivery convention.
  for (const e of EXTENSIONS.filter((x) => enabled[x.id])) {
    await writer.writeArtifact(
      `rules/extensions/${e.id}.md`,
      `# ${e.name} (enabled)\n\n${e.directive}\n`
    );
  }
  await reload();

  const names = EXTENSIONS.filter((e) => enabled[e.id]).map((e) => e.name);
  void audit.append("extensions.configure", {
    enabled: names.join(", ") || "(none)",
  });
  void vscode.window.showInformationMessage(
    names.length
      ? `Extensions enabled: ${names.join(", ")}.`
      : "All extensions disabled."
  );
}

/** Reset a stage back to not_started (e.g. to clear a stuck run). */
async function resetStage(
  services: AidlcServices,
  stageId: string,
  unitId?: string
): Promise<void> {
  const { store, writer, reload } = services;
  if (!store.state) {
    return;
  }
  store.update((s) => {
    if (unitId) {
      const unit = s.units.find((u) => u.id === unitId);
      if (unit?.stages[stageId]) {
        unit.stages[stageId].status = "not_started";
        unit.status = rollUpStatus(unit.stages);
      }
    } else if (s.stages[stageId]) {
      s.stages[stageId].status = "not_started";
    }
  });
  await writer.save(store.state);
  await reload();
  void services.audit.append("stage.reset", {
    stage: stageById(stageId)?.name ?? stageId,
    unit: unitId,
  });
  void vscode.window.showInformationMessage(
    `Reset "${stageById(stageId)?.name ?? stageId}".`
  );
}

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return;
  }
  const uri = vscode.Uri.joinPath(root.uri, ...relativePath.split("/"));
  if (!(await exists(uri))) {
    void vscode.window.showWarningMessage(`File not found: ${relativePath}`);
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: true });
}

async function syncJira(
  services: AidlcServices,
  direction: "push" | "pull"
): Promise<void> {
  const { context, store, writer, reload } = services;
  if (!store.state) {
    void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
    return;
  }
  const sync = await createJiraSync(context);
  if (!(await sync.isConfigured())) {
    const pick = await vscode.window.showWarningMessage(
      "Jira is not fully configured (base URL, email, project key, token).",
      "Set Credentials",
      "Open Settings"
    );
    if (pick === "Set Credentials") {
      await vscode.commands.executeCommand("aidlc.setJiraCredentials");
    } else if (pick === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "aidlc.jira"
      );
    }
    return;
  }

  const verb = direction === "push" ? "Syncing to" : "Pulling from";
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${verb} Jira…`,
      },
      async () => {
        await sync.verify();
        return direction === "push"
          ? sync.push(store.state!)
          : sync.pull(store.state!);
      }
    );
    await writer.save(store.state);
    await reload();
    void services.refreshJiraStatus();
    void services.audit.append(`jira.${direction}`, {
      created: result.created,
      updated: result.updated,
    });
    reportSync(sync, direction, result);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Jira ${direction} failed: ${describe(err)}`
    );
  }
}

/** Seed Construction units of work from open Jira stories, linked by key. */
async function importUnitsFromJira(services: AidlcServices): Promise<void> {
  const { context, store, writer, reload } = services;
  if (!store.state) {
    void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
    return;
  }
  const sync = await createJiraSync(context);
  if (!(await sync.isConfigured())) {
    const pick = await vscode.window.showWarningMessage(
      "Jira is not configured. Connect first.",
      "Connect to Jira"
    );
    if (pick) {
      await vscode.commands.executeCommand("aidlc.connectJira");
    }
    return;
  }
  try {
    const seeds = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Creating units of work from Jira…",
      },
      async () => {
        await sync.verify();
        return sync.fetchUnitSeeds();
      }
    );
    if (seeds.length === 0) {
      void vscode.window.showWarningMessage(
        "No open stories found. Adjust 'aidlc.jira.unitsJql' or the project key."
      );
      return;
    }

    let created = 0;
    let updated = 0;
    store.update((s) => {
      for (const seed of seeds) {
        const existing = s.units.find((u) => u.jiraKey === seed.key);
        if (existing) {
          existing.title = seed.summary;
          existing.description = seed.description || existing.description;
          existing.jiraStatus = seed.status;
          updated++;
        } else {
          s.units.push(makeUnitFromJira(seed, s.units));
          created++;
        }
      }
    });

    await writer.writeArtifact(
      "inception/workflow-plan.md",
      buildWorkflowPlan(store.state!.units)
    );
    store.update((s) => {
      s.stages["workflow-planning"] = {
        id: "workflow-planning",
        status: "complete",
        artifactPath: "inception/workflow-plan.md",
        updatedAt: new Date().toISOString(),
      };
    });
    await writer.save(store.state);
    await reload();
    void services.audit.append("jira.import.units", { created, updated });
    void vscode.window.showInformationMessage(
      `Units of work from Jira: ${created} created, ${updated} updated.`
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Jira import failed: ${describe(err)}`);
  }
}

function makeUnitFromJira(
  seed: { key: string; summary: string; description: string; status?: string },
  existing: UnitOfWork[]
): UnitOfWork {
  const base =
    seed.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    "unit";
  let id = base;
  let n = 2;
  const taken = new Set(existing.map((u) => u.id));
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  const stages: Record<string, StageState> = {};
  for (const stage of unitStages()) {
    stages[stage.id] = { id: stage.id, status: "not_started" };
  }
  return {
    id,
    title: seed.summary,
    description: seed.description || undefined,
    status: "not_started",
    stages,
    jiraKey: seed.key,
    jiraStatus: seed.status,
  };
}

function buildWorkflowPlan(units: UnitOfWork[]): string {
  const lines = ["# Workflow Plan — units of work (from Jira)", ""];
  lines.push(`_${units.length} unit(s). Source of truth: Jira._`, "");
  for (const u of units) {
    lines.push(
      `- **${u.title}**${u.jiraKey ? ` ([${u.jiraKey}])` : ""} — ${u.status}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Import existing issues (stories or requirements) from Jira into an artifact. */
async function importFromJira(
  services: AidlcServices,
  kind: "stories" | "requirements"
): Promise<void> {
  const { context, store, writer, reload } = services;
  if (!store.state) {
    void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
    return;
  }
  const sync = await createJiraSync(context);
  if (!(await sync.isConfigured())) {
    const pick = await vscode.window.showWarningMessage(
      "Jira is not configured. Connect first.",
      "Connect to Jira"
    );
    if (pick) {
      await vscode.commands.executeCommand("aidlc.connectJira");
    }
    return;
  }

  const spec =
    kind === "stories"
      ? {
          run: () => sync.importUserStories(),
          artifact: "inception/user-stories.md",
          stageId: "user-stories",
          label: "user stories",
          setting: "aidlc.jira.storiesJql",
          hint: "e.g. if your issue type is 'Récit'",
        }
      : {
          run: () => sync.importRequirements(),
          artifact: "inception/requirements.md",
          stageId: "requirements-analysis",
          label: "requirements",
          setting: "aidlc.jira.requirementsJql",
          hint: "requirements default to Epics",
        };

  try {
    const { markdown, count } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Importing ${spec.label} from Jira…`,
      },
      async () => {
        await sync.verify();
        return spec.run();
      }
    );
    if (count === 0) {
      void vscode.window.showWarningMessage(
        `No ${spec.label} found. Adjust '${spec.setting}' (${spec.hint}) or the project key.`
      );
      return;
    }
    await writer.writeArtifact(spec.artifact, markdown);
    store.update((s) => {
      s.stages[spec.stageId] = {
        id: spec.stageId,
        status: "complete",
        artifactPath: spec.artifact,
        updatedAt: new Date().toISOString(),
      };
    });
    await writer.save(store.state);
    await reload();
    const uri = docsChildUri(spec.artifact);
    if (uri) {
      await vscode.window.showTextDocument(uri, { preview: true });
    }
    void services.audit.append(`jira.import.${kind}`, { count });
    void vscode.window.showInformationMessage(
      `Imported ${count} ${spec.label} from Jira.`
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Jira import failed: ${describe(err)}`);
  }
}

/** Guided end-to-end Jira setup: base URL → email → project key → token. */
async function connectJira(services: AidlcServices): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("aidlc");
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  const baseUrl = await vscode.window.showInputBox({
    title: "Connect to Jira (1/4) — Site URL",
    prompt: "Your Atlassian site URL",
    placeHolder: "https://your-org.atlassian.net",
    ignoreFocusOut: true,
    value: cfg.get<string>("jira.baseUrl", ""),
    validateInput: (v) =>
      /^https?:\/\/.+/.test(v.trim()) ? undefined : "Enter a valid URL",
  });
  if (baseUrl === undefined) {
    return;
  }

  const email = await vscode.window.showInputBox({
    title: "Connect to Jira (2/4) — Account email",
    prompt: "The Atlassian account email for Basic auth",
    ignoreFocusOut: true,
    value: cfg.get<string>("jira.email", ""),
    validateInput: (v) => (v.includes("@") ? undefined : "Enter a valid email"),
  });
  if (email === undefined) {
    return;
  }

  const projectKey = await vscode.window.showInputBox({
    title: "Connect to Jira (3/4) — Project key",
    prompt: "Project key that units of work sync into",
    placeHolder: "AIDLC",
    ignoreFocusOut: true,
    value: cfg.get<string>("jira.projectKey", ""),
    validateInput: (v) =>
      v.trim().length > 0 ? undefined : "Project key is required",
  });
  if (projectKey === undefined) {
    return;
  }

  const token = await vscode.window.showInputBox({
    title: "Connect to Jira (4/4) — API token",
    prompt:
      "Create one at id.atlassian.com/manage-profile/security/api-tokens. Stored securely.",
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return;
  }

  await cfg.update("jira.baseUrl", baseUrl.trim(), target);
  await cfg.update("jira.email", email.trim(), target);
  await cfg.update("jira.projectKey", projectKey.trim(), target);
  if (token.trim()) {
    await services.context.secrets.store(SECRET_JIRA_TOKEN, token.trim());
  }

  const sync = await createJiraSync(services.context);
  try {
    const user = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Verifying Jira…" },
      () => sync.verify()
    );
    void services.refreshJiraStatus();
    const pick = await vscode.window.showInformationMessage(
      `Connected to Jira as ${user}.`,
      "Sync to Jira"
    );
    if (pick === "Sync to Jira") {
      await vscode.commands.executeCommand("aidlc.syncToJira");
    }
  } catch (err) {
    void services.refreshJiraStatus();
    void vscode.window.showErrorMessage(
      `Saved settings, but the connection test failed: ${describe(err)}`
    );
  }
}

/** Status-bar menu: actions depend on whether Jira is configured. */
async function jiraMenu(services: AidlcServices): Promise<void> {
  const sync = await createJiraSync(services.context);
  const configured = await sync.isConfigured();
  const items: (vscode.QuickPickItem & { id: string })[] = configured
    ? [
        { id: "push", label: "$(cloud-upload) Sync to Jira" },
        { id: "pull", label: "$(cloud-download) Pull Status from Jira" },
        {
          id: "stories",
          label: "$(book) Import User Stories from Jira",
        },
        {
          id: "requirements",
          label: "$(checklist) Import Requirements from Jira",
        },
        {
          id: "units",
          label: "$(tools) Create Units of Work from Jira",
        },
        { id: "connect", label: "$(plug) Reconnect / update credentials" },
        { id: "open", label: "$(link-external) Open Jira in browser" },
      ]
    : [{ id: "connect", label: "$(plug) Connect to Jira" }];

  const pick = await vscode.window.showQuickPick(items, {
    title: "Jira",
    placeHolder: configured ? "Choose a Jira action" : "Jira is not connected",
  });
  if (!pick) {
    return;
  }
  switch (pick.id) {
    case "push":
      return void vscode.commands.executeCommand("aidlc.syncToJira");
    case "pull":
      return void vscode.commands.executeCommand("aidlc.pullFromJira");
    case "stories":
      return void vscode.commands.executeCommand("aidlc.pullStoriesFromJira");
    case "requirements":
      return void vscode.commands.executeCommand("aidlc.pullRequirementsFromJira");
    case "units":
      return void vscode.commands.executeCommand("aidlc.importUnitsFromJira");
    case "connect":
      return void vscode.commands.executeCommand("aidlc.connectJira");
    case "open": {
      const baseUrl = vscode.workspace
        .getConfiguration("aidlc")
        .get<string>("jira.baseUrl", "");
      if (baseUrl) {
        void vscode.env.openExternal(vscode.Uri.parse(baseUrl));
      }
      return;
    }
  }
}

function reportSync(
  sync: TrackerSync,
  direction: "push" | "pull",
  result: { created: number; updated: number; messages: string[] }
): void {
  const summary =
    direction === "push"
      ? `${sync.name}: ${result.created} created, ${result.updated} updated.`
      : `${sync.name}: pulled ${result.updated} issue(s).`;
  void vscode.window
    .showInformationMessage(summary, "Details")
    .then((pick) => {
      if (pick === "Details" && result.messages.length) {
        const channel = vscode.window.createOutputChannel("AIDLC Jira Sync");
        channel.appendLine(summary);
        result.messages.forEach((m) => channel.appendLine(`  • ${m}`));
        channel.show();
      }
    });
}

async function runInit(services: AidlcServices): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showErrorMessage(
      "Open a folder before initializing an AI-DLC project."
    );
    return;
  }
  try {
    await initProject();
    await services.reload();
    void services.audit.append("project.init", {
      workspace: vscode.workspace.workspaceFolders[0].name,
    });
    void vscode.window.showInformationMessage(
      "AI-DLC project initialized. See the AIDLC view to drive the lifecycle."
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Failed to initialize AI-DLC project: ${describe(err)}`
    );
  }
}

async function openArtifact(relativePath: string): Promise<void> {
  const uri = docsChildUri(relativePath);
  if (!uri || !(await exists(uri))) {
    void vscode.window.showWarningMessage(
      `Artifact not found: ${relativePath}`
    );
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: true });
}

async function addUnitOfWork(services: AidlcServices): Promise<void> {
  const { store, writer, reload } = services;
  if (!store.state) {
    void vscode.window.showErrorMessage(
      "Initialize an AI-DLC project first."
    );
    return;
  }
  const title = await vscode.window.showInputBox({
    title: "New Unit of Work",
    prompt: "Short title for the construction unit of work",
    placeHolder: "e.g. User authentication service",
    validateInput: (v) =>
      v.trim().length === 0 ? "Title is required" : undefined,
  });
  if (!title) {
    return;
  }
  const unit = makeUnit(title.trim(), store.state.units);
  store.update((s) => s.units.push(unit));
  await writer.save(store.state);
  await reload();
  void services.audit.append("unit.add", { unit: unit.id, title: unit.title });
  void vscode.window.showInformationMessage(`Added unit of work: ${unit.title}`);
}

function makeUnit(title: string, existing: UnitOfWork[]): UnitOfWork {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unit";
  let id = base;
  let n = 2;
  const taken = new Set(existing.map((u) => u.id));
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  const stages: Record<string, StageState> = {};
  for (const stage of unitStages()) {
    stages[stage.id] = { id: stage.id, status: "not_started" };
  }
  return { id, title, status: "not_started", stages };
}

async function setAnthropicKey(services: AidlcServices): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: "Anthropic API Key",
    prompt: "Stored securely in VS Code SecretStorage",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-ant-...",
  });
  if (key === undefined) {
    return;
  }
  if (key.trim() === "") {
    await services.context.secrets.delete(SECRET_ANTHROPIC_KEY);
    void vscode.window.showInformationMessage("Anthropic API key cleared.");
    return;
  }
  await services.context.secrets.store(SECRET_ANTHROPIC_KEY, key.trim());
  await vscode.workspace
    .getConfiguration("aidlc")
    .update("anthropic.authMethod", "apiKey", vscode.ConfigurationTarget.Global);
  await verifyAnthropic(services, "Anthropic API key");
}

async function setAnthropicToken(services: AidlcServices): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "Anthropic Auth Token (Bearer)",
    prompt:
      "Sent as 'Authorization: Bearer …'. For OAuth/subscription or gateway tokens (not officially supported by Anthropic). Stored securely.",
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return;
  }
  if (token.trim() === "") {
    await services.context.secrets.delete(SECRET_ANTHROPIC_AUTH_TOKEN);
    void vscode.window.showInformationMessage("Anthropic auth token cleared.");
    return;
  }
  await services.context.secrets.store(SECRET_ANTHROPIC_AUTH_TOKEN, token.trim());
  await vscode.workspace
    .getConfiguration("aidlc")
    .update(
      "anthropic.authMethod",
      "authToken",
      vscode.ConfigurationTarget.Global
    );
  void vscode.window.showInformationMessage(
    "Auth token saved (auth method set to Bearer). If your token needs an anthropic-beta header, set 'aidlc.anthropic.betaHeader' in Settings."
  );
  await verifyAnthropic(services, "Anthropic auth token");
}

async function setClaudeCodeToken(services: AidlcServices): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("aidlc");
  const choice = await vscode.window.showQuickPick(
    [
      {
        id: "ambient",
        label: "$(pass) Use my existing Claude Code login",
        detail:
          "Recommended — if you're already signed into Claude Code on this machine, no token is needed.",
      },
      {
        id: "token",
        label: "$(key) Paste a setup-token",
        detail: "From 'claude setup-token' in a terminal.",
      },
    ],
    {
      title: "Claude Code / Subscription",
      placeHolder: "How should the plugin authenticate to Claude Code?",
    }
  );
  if (!choice) {
    return;
  }

  await cfg.update(
    "anthropic.authMethod",
    "claudeCode",
    vscode.ConfigurationTarget.Global
  );

  if (choice.id === "ambient") {
    // Clear any stored token so it can't override the machine's own login.
    await services.context.secrets.delete(SECRET_CLAUDE_CODE_TOKEN);
    await verifyAnthropic(services, "Claude Code (existing login)");
    return;
  }

  const token = await vscode.window.showInputBox({
    title: "Claude Code OAuth Token",
    prompt:
      "Token from 'claude setup-token' (stored as CLAUDE_CODE_OAUTH_TOKEN, tied to your Claude subscription).",
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return;
  }
  if (token.trim() === "") {
    await services.context.secrets.delete(SECRET_CLAUDE_CODE_TOKEN);
    void vscode.window.showInformationMessage(
      "Token cleared — using existing Claude Code login."
    );
    await verifyAnthropic(services, "Claude Code (existing login)");
    return;
  }
  await services.context.secrets.store(SECRET_CLAUDE_CODE_TOKEN, token.trim());
  await verifyAnthropic(services, "Claude Code token");
}

/** Verify the active Anthropic credential and report the result. */
async function verifyAnthropic(
  services: AidlcServices,
  label: string
): Promise<void> {
  const client = new AnthropicClient(services.context);
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Verifying ${label}…`,
      },
      () => client.verify()
    );
    void vscode.window.showInformationMessage(`${label} saved and verified.`);
  } catch (err) {
    void vscode.window.showWarningMessage(
      `Saved, but verification failed: ${describe(err)}`
    );
  }
}

async function setJiraCredentials(services: AidlcServices): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "Jira API Token",
    prompt:
      "Create one at id.atlassian.com/manage-profile/security/api-tokens. Stored securely.",
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return;
  }
  if (token.trim() === "") {
    await services.context.secrets.delete(SECRET_JIRA_TOKEN);
    void vscode.window.showInformationMessage("Jira token cleared.");
    return;
  }
  await services.context.secrets.store(SECRET_JIRA_TOKEN, token.trim());
  void vscode.window.showInformationMessage(
    "Jira token saved. Set base URL, email and project key in Settings."
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
