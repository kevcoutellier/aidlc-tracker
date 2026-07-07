import * as vscode from "vscode";

export const STATE_FILE = "aidlc-state.md";

/** The first workspace folder, or undefined when no folder is open. */
export function workspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/** Configured docs folder name (workspace-relative), default `aidlc-docs`. */
export function docsFolderName(): string {
  return vscode.workspace
    .getConfiguration("aidlc")
    .get<string>("docsPath", "aidlc-docs");
}

/** Absolute URI of the AI-DLC docs folder for the open workspace. */
export function docsUri(root = workspaceRoot()): vscode.Uri | undefined {
  if (!root) {
    return undefined;
  }
  return vscode.Uri.joinPath(root.uri, docsFolderName());
}

/** Absolute URI of the persisted state file. */
export function stateUri(root = workspaceRoot()): vscode.Uri | undefined {
  const docs = docsUri(root);
  return docs ? vscode.Uri.joinPath(docs, STATE_FILE) : undefined;
}

/** Join a docs-relative path (may contain `/`) onto the docs folder. */
export function docsChildUri(
  relative: string,
  root = workspaceRoot()
): vscode.Uri | undefined {
  const docs = docsUri(root);
  if (!docs) {
    return undefined;
  }
  return vscode.Uri.joinPath(docs, ...relative.split("/"));
}
