import * as vscode from "vscode";
import { createJiraSync } from "./JiraSync";

/** Status-bar indicator + verifier for the Jira connection. */
export class JiraStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "aidlc.jiraMenu";
    context.subscriptions.push(this.item);
    this.item.show();
  }

  /** Re-read config/secret, verify if configured, and update the indicator. */
  async refresh(): Promise<void> {
    const sync = await createJiraSync(this.context);
    if (!(await sync.isConfigured())) {
      this.set("$(cloud) Jira: connect", "Jira not configured — click to connect.");
      return;
    }
    this.set("$(sync~spin) Jira…", "Verifying Jira connection…");
    try {
      const user = await sync.verify();
      const project = vscode.workspace
        .getConfiguration("aidlc")
        .get<string>("jira.projectKey", "");
      this.set(
        `$(cloud) Jira: ${project || "connected"}`,
        `Connected to Jira as ${user}. Click for actions.`
      );
    } catch (err) {
      this.set(
        "$(warning) Jira: error",
        `Jira connection failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private set(text: string, tooltip: string): void {
    this.item.text = text;
    this.item.tooltip = tooltip;
  }

  dispose(): void {
    this.item.dispose();
  }
}
