import * as vscode from "vscode";
import { LiveRunView } from "../model/dashboard";

/**
 * In-memory store of the generation currently in flight, updated by the
 * orchestrator from the Agent SDK stream (tools, turns, subagent Task calls)
 * and observed by the dashboard. Fires on every mutation; consumers throttle.
 */
export class LiveRunStore implements vscode.Disposable {
  private _run: LiveRunView | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<
    LiveRunView | undefined
  >();
  readonly onDidChange = this._onDidChange.event;

  get run(): LiveRunView | undefined {
    return this._run;
  }

  begin(run: LiveRunView): void {
    this._run = run;
    this._onDidChange.fire(run);
  }

  update(mutate: (run: LiveRunView) => void): void {
    if (!this._run) {
      return;
    }
    mutate(this._run);
    this._onDidChange.fire(this._run);
  }

  end(): void {
    if (!this._run) {
      return;
    }
    this._run = undefined;
    this._onDidChange.fire(undefined);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
