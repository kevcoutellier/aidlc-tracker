import * as vscode from "vscode";
import { ProjectState } from "../model/types";

/**
 * In-memory single source of truth for the tracked project while the editor is
 * open. Views subscribe to {@link onDidChange}; the parser/orchestrator mutate
 * it. Durable state lives in `aidlc-state.md` (written by StateWriter).
 */
export class ProjectStore implements vscode.Disposable {
  private _state: ProjectState | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<
    ProjectState | undefined
  >();

  /** Fires whenever project state is replaced or mutated. */
  readonly onDidChange = this._onDidChange.event;

  get state(): ProjectState | undefined {
    return this._state;
  }

  get hasProject(): boolean {
    return this._state !== undefined;
  }

  /** Replace the whole state (e.g. after a fresh parse) and notify listeners. */
  setState(state: ProjectState | undefined): void {
    this._state = state;
    this._onDidChange.fire(state);
  }

  /** Mutate the current state in place and notify listeners. No-op if empty. */
  update(mutator: (state: ProjectState) => void): void {
    if (!this._state) {
      return;
    }
    mutator(this._state);
    this._onDidChange.fire(this._state);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
