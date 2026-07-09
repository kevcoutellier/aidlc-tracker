import * as vscode from "vscode";
import { ProjectStore } from "./core/ProjectStore";
import { ArtifactParser } from "./core/ArtifactParser";
import { StateWriter } from "./core/StateWriter";
import { FileWatcher } from "./core/FileWatcher";
import { ClaudeStore } from "./core/ClaudeStore";
import { ClaudeScanner } from "./core/ClaudeScanner";
import { AuditLog } from "./core/AuditLog";
import { AidlcTreeProvider } from "./views/AidlcTreeProvider";
import { ClaudeAssetsProvider } from "./views/ClaudeAssetsProvider";
import { monitorTick, registerCommands } from "./commands";
import { AidlcServices } from "./services";
import { AnthropicClient } from "./orchestrator/AnthropicClient";
import { Orchestrator } from "./orchestrator/Orchestrator";
import { JiraStatusBar } from "./integrations/jira/JiraStatusBar";
import {
  DevActivityService,
  DevActivityStore,
} from "./integrations/github/DevActivityService";
import { docsFolderName } from "./core/paths";
import { rollUpStatus } from "./model/status";

export function activate(context: vscode.ExtensionContext): void {
  const store = new ProjectStore();
  const parser = new ArtifactParser();
  const writer = new StateWriter();
  const claudeStore = new ClaudeStore();
  const claudeScanner = new ClaudeScanner();
  const jiraStatusBar = new JiraStatusBar(context);
  const devStore = new DevActivityStore();
  const devService = new DevActivityService();
  const audit = new AuditLog();

  const reload = async (): Promise<void> => {
    const state = await parser.load();
    store.setState(state);
    await vscode.commands.executeCommand(
      "setContext",
      "aidlc.hasProject",
      store.hasProject
    );
  };

  const reloadClaude = async (): Promise<void> => {
    const assets = await claudeScanner.scan();
    claudeStore.setAssets(assets);
    await vscode.commands.executeCommand(
      "setContext",
      "aidlc.hasClaude",
      claudeStore.hasClaude
    );
  };

  const refreshJiraStatus = () => jiraStatusBar.refresh();

  const services: AidlcServices = {
    context,
    store,
    parser,
    writer,
    claudeStore,
    jiraStatusBar,
    devStore,
    devService,
    audit,
    reload,
    reloadClaude,
    refreshJiraStatus,
  };

  const treeProvider = new AidlcTreeProvider(store);
  const lifecycleView = vscode.window.createTreeView("aidlcExplorer", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const claudeProvider = new ClaudeAssetsProvider(claudeStore);
  const claudeView = vscode.window.createTreeView("aidlcClaudeAssets", {
    treeDataProvider: claudeProvider,
    showCollapseAll: true,
  });

  const docsWatcher = new FileWatcher(
    () => [`${docsFolderName()}/**`],
    () => void reload()
  );
  const claudeWatcher = new FileWatcher(
    () => [".claude/**", "CLAUDE.md", "AGENTS.md"],
    () => void reloadClaude()
  );

  const anthropic = new AnthropicClient(context);
  const orchestrator = new Orchestrator(services, anthropic);

  registerCommands(services, orchestrator);

  // Passive monitoring: on an interval, silently refresh dev activity and pull
  // Jira statuses so the console reflects reality without any user action.
  let monitorTimer: NodeJS.Timeout | undefined;
  const rescheduleMonitor = (): void => {
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = undefined;
    }
    const minutes = vscode.workspace
      .getConfiguration("aidlc")
      .get<number>("monitor.intervalMinutes", 5);
    if (minutes > 0) {
      monitorTimer = setInterval(
        () => void monitorTick(services),
        Math.max(1, minutes) * 60_000
      );
    }
  };
  rescheduleMonitor();
  context.subscriptions.push({
    dispose: () => {
      if (monitorTimer) {
        clearInterval(monitorTimer);
      }
    },
  });

  context.subscriptions.push(
    store,
    claudeStore,
    devStore,
    lifecycleView,
    claudeView,
    docsWatcher,
    claudeWatcher,
    jiraStatusBar,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aidlc.docsPath")) {
        docsWatcher.rebuild();
        void reload();
      }
      if (e.affectsConfiguration("aidlc.jira")) {
        void refreshJiraStatus();
      }
      if (e.affectsConfiguration("aidlc.monitor")) {
        rescheduleMonitor();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      docsWatcher.rebuild();
      claudeWatcher.rebuild();
      void reload();
      void reloadClaude();
    })
  );

  // A fresh session can have no active run, so any persisted "in_progress" is
  // stale (a generation interrupted by a reload). Clear it so the tree doesn't
  // show ghost spinners forever.
  void (async () => {
    await reload();
    await resetStaleRuns(store, writer);
  })();
  void reloadClaude();
  void refreshJiraStatus();
}

async function resetStaleRuns(
  store: ProjectStore,
  writer: StateWriter
): Promise<void> {
  const state = store.state;
  if (!state) {
    return;
  }
  let changed = false;
  for (const id of Object.keys(state.stages)) {
    if (state.stages[id].status === "in_progress") {
      state.stages[id].status = "not_started";
      changed = true;
    }
  }
  for (const unit of state.units) {
    for (const id of Object.keys(unit.stages)) {
      if (unit.stages[id].status === "in_progress") {
        unit.stages[id].status = "not_started";
        changed = true;
      }
    }
    unit.status = rollUpStatus(unit.stages);
  }
  if (changed) {
    await writer.save(state);
    store.setState(state);
  }
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate().
}
