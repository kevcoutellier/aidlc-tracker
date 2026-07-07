import * as vscode from "vscode";
import { PhaseId, ProjectState, StageStatus, UnitOfWork } from "../model/types";
import {
  PHASES,
  artifactPath,
  phaseById,
  stageById,
  stagesForPhase,
} from "../model/aidlcDefinition";
import { ProjectStore } from "../core/ProjectStore";

type TreeNode =
  | { kind: "phase"; phaseId: PhaseId }
  | { kind: "unit"; unitId: string }
  | { kind: "stage"; stageId: string; unitId?: string }
  | { kind: "message"; label: string };

const STATUS_ICON: Record<StageStatus, vscode.ThemeIcon> = {
  not_started: new vscode.ThemeIcon("circle-large-outline"),
  in_progress: new vscode.ThemeIcon(
    "sync~spin",
    new vscode.ThemeColor("charts.blue")
  ),
  awaiting_approval: new vscode.ThemeIcon(
    "eye",
    new vscode.ThemeColor("charts.yellow")
  ),
  blocked: new vscode.ThemeIcon(
    "error",
    new vscode.ThemeColor("charts.red")
  ),
  complete: new vscode.ThemeIcon(
    "pass-filled",
    new vscode.ThemeColor("charts.green")
  ),
};

const PHASE_ICON: Record<PhaseId, string> = {
  inception: "lightbulb",
  construction: "tools",
  operations: "server-environment",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  not_started: "",
  in_progress: "in progress",
  awaiting_approval: "review",
  blocked: "blocked",
  complete: "done",
};

export class AidlcTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ProjectStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const state = this.store.state;
    if (!state) {
      return [];
    }
    if (!element) {
      return PHASES.map((p) => ({ kind: "phase", phaseId: p.id }));
    }
    switch (element.kind) {
      case "phase":
        return this.phaseChildren(element.phaseId, state);
      case "unit":
        return stagesForPhase("construction")
          .filter((s) => s.perUnit)
          .map((s) => ({
            kind: "stage",
            stageId: s.id,
            unitId: element.unitId,
          }));
      default:
        return [];
    }
  }

  private phaseChildren(phaseId: PhaseId, state: ProjectState): TreeNode[] {
    if (phaseId === "construction") {
      if (state.units.length === 0) {
        return [
          {
            kind: "message",
            label: "No units of work yet — add one from the title bar.",
          },
        ];
      }
      return state.units.map((u) => ({ kind: "unit", unitId: u.id }));
    }
    return stagesForPhase(phaseId)
      .filter((s) => !s.perUnit)
      .map((s) => ({ kind: "stage", stageId: s.id }));
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const state = this.store.state;
    switch (node.kind) {
      case "phase":
        return this.phaseItem(node.phaseId, state);
      case "unit":
        return this.unitItem(this.findUnit(node.unitId, state));
      case "stage":
        return this.stageItem(node.stageId, node.unitId, state);
      case "message": {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
    }
  }

  private phaseItem(
    phaseId: PhaseId,
    state: ProjectState | undefined
  ): vscode.TreeItem {
    const def = phaseById(phaseId)!;
    const item = new vscode.TreeItem(
      def.name,
      phaseId === state?.currentPhase
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    item.iconPath = new vscode.ThemeIcon(PHASE_ICON[phaseId]);
    item.contextValue = "phase";
    item.description = this.phaseProgress(phaseId, state);
    item.tooltip = def.description;
    return item;
  }

  private phaseProgress(
    phaseId: PhaseId,
    state: ProjectState | undefined
  ): string {
    if (!state) {
      return "";
    }
    if (phaseId === "construction") {
      const total = state.units.length;
      const done = state.units.filter((u) => u.status === "complete").length;
      return total === 0 ? "" : `${done}/${total} units`;
    }
    const stages = stagesForPhase(phaseId).filter((s) => !s.perUnit);
    const done = stages.filter(
      (s) => state.stages[s.id]?.status === "complete"
    ).length;
    return `${done}/${stages.length}`;
  }

  private unitItem(unit: UnitOfWork | undefined): vscode.TreeItem {
    const item = new vscode.TreeItem(
      unit?.title ?? "Unknown unit",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    const status = unit?.status ?? "not_started";
    item.iconPath = STATUS_ICON[status];
    item.description = [
      STATUS_LABEL[status],
      unit?.jiraKey,
      unit?.jiraStatus ? `(${unit.jiraStatus})` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    item.contextValue = `unit:${status}`;
    item.tooltip = unit?.description;
    return item;
  }

  private stageItem(
    stageId: string,
    unitId: string | undefined,
    state: ProjectState | undefined
  ): vscode.TreeItem {
    const def = stageById(stageId);
    const unit = unitId ? this.findUnit(unitId, state) : undefined;
    const stageState = unitId
      ? unit?.stages[stageId]
      : state?.stages[stageId];
    const status = stageState?.status ?? "not_started";

    const item = new vscode.TreeItem(
      def?.name ?? stageId,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = STATUS_ICON[status];
    item.description = STATUS_LABEL[status];
    item.tooltip = def?.description;
    item.contextValue = `stage:${status}:${stageId}`;

    const rel = stageState?.artifactPath ?? (def ? artifactPath(def, unitId) : undefined);
    if (rel && stageState?.artifactPath) {
      item.command = {
        command: "aidlc.openArtifact",
        title: "Open Artifact",
        arguments: [rel],
      };
    }
    return item;
  }

  private findUnit(
    unitId: string,
    state: ProjectState | undefined
  ): UnitOfWork | undefined {
    return state?.units.find((u) => u.id === unitId);
  }
}
