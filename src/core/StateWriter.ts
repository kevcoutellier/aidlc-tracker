import * as vscode from "vscode";
import { ProjectState } from "../model/types";
import { docsChildUri, stateUri, trackerStateUri } from "./paths";
import { ensureDir, exists, readText, writeText } from "./fsUtil";
import { serializeState, STATE_BEGIN } from "./stateSerde";

export { parsePersistedState, serializeState } from "./stateSerde";

/**
 * Where tracker state lives. Native projects own `aidlc-state.md`; when that
 * file exists but was written by another tool (AWS aidlc-workflows), tracker
 * state moves to `aidlc-tracker-state.md` and the foreign file is never
 * rewritten.
 */
export async function resolveStateUri(): Promise<vscode.Uri | undefined> {
  const primary = stateUri();
  const fallback = trackerStateUri();
  if (!primary || !fallback) {
    return undefined;
  }
  if (await exists(primary)) {
    const text = await readText(primary);
    return text.includes(STATE_BEGIN) ? primary : fallback;
  }
  // No primary file: keep using the tracker file if it already holds state.
  return (await exists(fallback)) ? fallback : primary;
}

/** Persists project state and produced artifacts to the docs folder. */
export class StateWriter {
  /** Write the state file, never clobbering a foreign `aidlc-state.md`. */
  async save(state: ProjectState): Promise<void> {
    const uri = await resolveStateUri();
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
