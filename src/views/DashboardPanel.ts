import * as vscode from "vscode";
import { AidlcServices } from "../services";
import {
  WebviewCommandMessage,
  buildDashboardModel,
} from "../model/dashboard";

/** Commands the dashboard is allowed to invoke (defence in depth). */
const ALLOWED_COMMANDS = new Set([
  "aidlc.initProject",
  "aidlc.refresh",
  "aidlc.runNextStage",
  "aidlc.runStage",
  "aidlc.addUnitOfWork",
  "aidlc.openArtifact",
  "aidlc.approveArtifact",
  "aidlc.requestChanges",
  "aidlc.syncToJira",
  "aidlc.pullFromJira",
  "aidlc.importUnitsFromJira",
  "aidlc.connectJira",
  "aidlc.openJiraIssue",
  "aidlc.refreshDevActivity",
  "aidlc.openExternalGitHub",
  "aidlc.runTests",
  "aidlc.configureExtensions",
  "aidlc.openAuditLog",
  "aidlc.runUnitPipeline",
  "aidlc.handoffUnit",
]);

/** Singleton webview panel showing lifecycle progress and quick actions. */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(services: AidlcServices): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      DashboardPanel.current.post();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "aidlcDashboard",
      "AIDLC Dashboard",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(services.context.extensionUri, "dist"),
          vscode.Uri.joinPath(services.context.extensionUri, "media"),
        ],
      }
    );
    DashboardPanel.current = new DashboardPanel(panel, services);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly services: AidlcServices
  ) {
    this.panel.webview.html = this.html();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewCommandMessage) => this.onMessage(msg),
      null,
      this.disposables
    );

    this.disposables.push(
      services.store.onDidChange(() => this.post()),
      services.devStore.onDidChange(() => this.post())
    );

    // Push initial state once the webview script has loaded and asked for it,
    // and kick off a non-interactive dev-activity refresh in the background.
    this.post();
    void vscode.commands.executeCommand("aidlc.refreshDevActivity", false);
  }

  private onMessage(msg: WebviewCommandMessage | { type: "ready" }): void {
    if (msg?.type === "ready") {
      this.post();
      return;
    }
    if (msg?.type === "command" && ALLOWED_COMMANDS.has(msg.command)) {
      void vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
    }
  }

  private post(): void {
    const jiraBaseUrl = vscode.workspace
      .getConfiguration("aidlc")
      .get<string>("jira.baseUrl", "")
      .trim();
    const model = buildDashboardModel(this.services.store.state, {
      jiraBaseUrl: jiraBaseUrl || undefined,
      dev: this.services.devStore.activity,
    });
    void this.panel.webview.postMessage({ type: "state", model });
  }

  private uri(...segments: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.services.context.extensionUri, ...segments)
    );
  }

  private html(): string {
    const nonce = makeNonce();
    const scriptUri = this.uri("dist", "webview.js");
    const styleUri = this.uri("media", "dashboard.css");
    const cspSource = this.panel.webview.cspSource;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>AIDLC Dashboard</title>
</head>
<body>
  <div id="root">
    <p class="muted">Loading AI-DLC state…</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
