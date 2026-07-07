import * as vscode from "vscode";
import { ProjectState } from "../model/types";
import { docsChildUri, stateUri } from "./paths";
import { ensureDir, writeText } from "./fsUtil";
import { serializeState } from "./stateSerde";

export { parsePersistedState, serializeState } from "./stateSerde";

/** Persists project state and produced artifacts to the docs folder. */
export class StateWriter {
  /** Write the `aidlc-state.md` file for the given state. */
  async save(state: ProjectState): Promise<void> {
    const uri = stateUri();
    if (!uri) {
      throw new Error("No workspace folder is open.");
    }
    await ensureDir(vscode.Uri.joinPath(uri, ".."));
    await writeText(uri, serializeState(state));
  }

  /**
   * Write an artifact file at a docs-relative path, creating parent folders.
   * Returns the docs-relative path that was written.
   */
  async writeArtifact(relativePath: string, content: string): Promise<string> {
    const uri = docsChildUri(relativePath);
    if (!uri) {
      throw new Error("No workspace folder is open.");
    }
    await ensureDir(vscode.Uri.joinPath(uri, ".."));
    await writeText(uri, content);
    return relativePath;
  }
}
