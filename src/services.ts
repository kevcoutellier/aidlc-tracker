import * as vscode from "vscode";
import { ProjectStore } from "./core/ProjectStore";
import { ArtifactParser } from "./core/ArtifactParser";
import { StateWriter } from "./core/StateWriter";
import { ClaudeStore } from "./core/ClaudeStore";
import { JiraStatusBar } from "./integrations/jira/JiraStatusBar";

/** Secret-storage keys. Secrets never live in settings or files. */
export const SECRET_ANTHROPIC_KEY = "aidlc.anthropicApiKey";
export const SECRET_ANTHROPIC_AUTH_TOKEN = "aidlc.anthropicAuthToken";
export const SECRET_CLAUDE_CODE_TOKEN = "aidlc.claudeCodeOAuthToken";
export const SECRET_JIRA_TOKEN = "aidlc.jiraApiToken";

/** Shared dependencies passed to command handlers and the orchestrator. */
export interface AidlcServices {
  readonly context: vscode.ExtensionContext;
  readonly store: ProjectStore;
  readonly parser: ArtifactParser;
  readonly writer: StateWriter;
  readonly claudeStore: ClaudeStore;
  readonly jiraStatusBar: JiraStatusBar;
  /** Re-read AI-DLC state from disk into the store and refresh context keys. */
  reload(): Promise<void>;
  /** Re-scan `.claude/` assets into the Claude store. */
  reloadClaude(): Promise<void>;
  /** Re-verify and refresh the Jira status-bar indicator. */
  refreshJiraStatus(): Promise<void>;
}
