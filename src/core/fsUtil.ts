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

/** Stat a path, or undefined when it does not exist. */
export async function statOrUndefined(
  uri: vscode.Uri
): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

/** Sorted names of child directories; [] when the path is missing. */
export async function listDirectories(uri: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
}

/** Sorted names of child `*.md` files; [] when the path is missing. */
export async function listMarkdownFiles(uri: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries
      .filter(
        ([name, type]) =>
          type === vscode.FileType.File && name.toLowerCase().endsWith(".md")
      )
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
}
