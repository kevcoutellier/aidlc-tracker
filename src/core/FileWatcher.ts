import * as vscode from "vscode";
import { workspaceRoot } from "./paths";

/**
 * Watches one or more workspace-relative glob patterns and invokes `onChange`
 * (debounced) on any create/change/delete, so views stay live with edits made
 * outside the extension. Patterns are resolved lazily so they can depend on
 * settings (e.g. the configurable docs path).
 */
export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly getPatterns: () => string[],
    private readonly onChange: () => void
  ) {
    this.rebuild();
  }

  /** Recreate watchers (e.g. after a relevant setting changes). */
  rebuild(): void {
    this.disposeWatchers();
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const fire = () => this.schedule();
    for (const pattern of this.getPatterns()) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, pattern)
      );
      watcher.onDidCreate(fire);
      watcher.onDidChange(fire);
      watcher.onDidDelete(fire);
      this.watchers.push(watcher);
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.onChange(), 200);
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposeWatchers();
  }
}
