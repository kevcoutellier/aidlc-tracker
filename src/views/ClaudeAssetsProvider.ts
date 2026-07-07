import * as vscode from "vscode";
import { ClaudeAsset, ClaudeAssetKind, ClaudeAssets } from "../model/claude";
import { ClaudeStore } from "../core/ClaudeStore";

interface GroupNode {
  kind: "group";
  group: ClaudeAssetKind;
}
interface AssetNode {
  kind: "asset";
  asset: ClaudeAsset;
}
interface MessageNode {
  kind: "message";
  label: string;
}
type Node = GroupNode | AssetNode | MessageNode;

const GROUPS: {
  key: ClaudeAssetKind;
  label: string;
  icon: string;
  pick: (a: ClaudeAssets) => ClaudeAsset[];
}[] = [
  { key: "agent", label: "Agents", icon: "hubot", pick: (a) => a.agents },
  { key: "command", label: "Commands", icon: "terminal", pick: (a) => a.commands },
  { key: "skill", label: "Skills", icon: "lightbulb", pick: (a) => a.skills },
  { key: "memory", label: "Memory", icon: "book", pick: (a) => a.memory },
  { key: "settings", label: "Settings", icon: "settings-gear", pick: (a) => a.settings },
];

const ASSET_ICON: Record<ClaudeAssetKind, string> = {
  agent: "hubot",
  command: "terminal",
  skill: "lightbulb",
  memory: "book",
  settings: "settings-gear",
};

/** Tree of Claude Code assets grouped by kind. */
export class ClaudeAssetsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    Node | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ClaudeStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getChildren(element?: Node): Node[] {
    const assets = this.store.assets;
    if (!assets) {
      return [];
    }
    if (!element) {
      const groups = GROUPS.filter((g) => g.pick(assets).length > 0).map(
        (g): Node => ({ kind: "group", group: g.key })
      );
      return groups.length > 0
        ? groups
        : [{ kind: "message", label: "No Claude assets found in .claude/." }];
    }
    if (element.kind === "group") {
      const def = GROUPS.find((g) => g.key === element.group)!;
      return def
        .pick(assets)
        .map((asset): Node => ({ kind: "asset", asset }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "message") {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (node.kind === "group") {
      const def = GROUPS.find((g) => g.key === node.group)!;
      const count = def.pick(this.store.assets!).length;
      const item = new vscode.TreeItem(
        def.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = String(count);
      item.iconPath = new vscode.ThemeIcon(def.icon);
      item.contextValue = `claudeGroup:${def.key}`;
      return item;
    }
    const { asset } = node;
    const item = new vscode.TreeItem(
      asset.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = truncate(asset.description);
    item.tooltip = asset.description
      ? `${asset.path}\n\n${asset.description}`
      : asset.path;
    item.iconPath = new vscode.ThemeIcon(ASSET_ICON[asset.kind]);
    item.contextValue = `claudeAsset:${asset.kind}`;
    item.command = {
      command: "aidlc.openClaudeAsset",
      title: "Open",
      arguments: [asset.path],
    };
    return item;
  }
}

function truncate(s: string | undefined, max = 80): string {
  if (!s) {
    return "";
  }
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
