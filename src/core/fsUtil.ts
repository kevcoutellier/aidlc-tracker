import * as vscode from "vscode";

/** Thin promise helpers over `vscode.workspace.fs` (virtual-fs friendly). */

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

export async function writeText(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
}

export async function ensureDir(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(uri);
}

/** Write a file only if it does not already exist. Returns true if written. */
export async function writeIfAbsent(
  uri: vscode.Uri,
  content: string
): Promise<boolean> {
  if (await exists(uri)) {
    return false;
  }
  await writeText(uri, content);
  return true;
}
