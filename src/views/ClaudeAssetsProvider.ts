import * as vscode from "vscode";
import { ClaudeAsset, ClaudeAssetKind, ClaudeAssets } from "../model/claude";
import { ClaudeStore } from "../core/ClaudeStore";

interface GroupNode {
  kind: "group";
  group: string;
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
  key: string;
  label: string;
  icon: string;
  /** Large reference groups start collapsed. */
  collapsed?: boolean;
  pick: (a: ClaudeAssets) => ClaudeAsset[];
}[] = [
  { key: "agents", label: "Agents", icon: "hubot", pick: (a) => a.agents },
  { key: "commands", label: "Commands", icon: "terminal", pick: (a) => a.commands },
  { key: "skills", label: "Skills", icon: "lightbulb", pick: (a) => a.skills },
  { key: "memory", label: "Memory", icon: "book", pick: (a) => a.memory },
  { key: "settings", label: "Settings", icon: "settings-gear", pick: (a) => a.settings },
  { key: "kiroSteering", label: "Kiro Steering", icon: "compass", pick: (a) => a.kiroSteering },
  { key: "kiroSpecs", label: "Kiro Specs", icon: "notebook", pick: (a) => a.kiroSpecs },
  { key: "kiroHooks", label: "Kiro Hooks", icon: "zap", pick: (a) => a.kiroHooks },
  { key: "kiroSettings", label: "Kiro Settings", icon: "settings-gear", pick: (a) => a.kiroSettings },
  { key: "aidlcRules", label: "AI-DLC Rules", icon: "law", collapsed: true, pick: (a) => a.aidlcRules },
  { key: "cursorRules", label: "Cursor Rules", icon: "pencil", pick: (a) => a.cursorRules },
  { key: "amazonqRules", label: "Amazon Q Rules", icon: "cloud", pick: (a) => a.amazonqRules },
  { key: "shared", label: "Shared", icon: "globe", pick: (a) => a.shared },
];

const ASSET_ICON: Record<ClaudeAssetKind, string> = {
  agent: "hubot",
  command: "terminal",
  skill: "lightbulb",
  memory: "book",
  settings: "settings-gear",
  steering: "compass",
  rule: "law",
  spec: "notebook",
  hook: "zap",
};

/** Tree of agent assets (Claude Code, Kiro, Cursor, Amazon Q) by group. */
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
        : [
            {
              kind: "message",
              label:
                "No agent assets found (.claude/, .kiro/, .cursor/, .amazonq/).",
            },
          ];
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
        def.collapsed
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded
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
    const detail = asset.badge
      ? asset.description
        ? `${asset.badge} — ${asset.description}`
        : asset.badge
      : asset.description;
    item.description = truncate(detail);
    item.tooltip = detail ? `${asset.path}\n\n${detail}` : asset.path;
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
