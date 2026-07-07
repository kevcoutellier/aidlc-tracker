import * as vscode from "vscode";
import { ClaudeAssets } from "../model/claude";

/** In-memory store for discovered Claude assets, with a change event. */
export class ClaudeStore implements vscode.Disposable {
  private _assets: ClaudeAssets | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<
    ClaudeAssets | undefined
  >();
  readonly onDidChange = this._onDidChange.event;

  get assets(): ClaudeAssets | undefined {
    return this._assets;
  }

  get hasClaude(): boolean {
    return this._assets?.hasClaude ?? false;
  }

  setAssets(assets: ClaudeAssets | undefined): void {
    this._assets = assets;
    this._onDidChange.fire(assets);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
