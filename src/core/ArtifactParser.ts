import {
  ArtifactRef,
  PersistedState,
  ProjectState,
  StageState,
  UnitOfWork,
} from "../model/types";
import {
  artifactPath,
  projectLevelStages,
  unitStages,
} from "../model/aidlcDefinition";
import { docsChildUri, docsUri, stateUri, workspaceRoot } from "./paths";
import { exists, readText } from "./fsUtil";
import { parsePersistedState } from "./StateWriter";
import { reconcileStageStatus, rollUpStatus } from "../model/status";

/**
 * Builds {@link ProjectState} from the docs folder: reads persisted state from
 * `aidlc-state.md` and reconciles it with artifact files present on disk (a
 * present artifact with no recorded status counts as `complete`).
 */
export class ArtifactParser {
  /** Returns undefined when there is no workspace or no docs folder. */
  async load(): Promise<ProjectState | undefined> {
    const root = workspaceRoot();
    const docs = docsUri(root);
    if (!root || !docs || !(await exists(docs))) {
      return undefined;
    }

    const persisted = await this.readPersisted();
    const artifacts: ArtifactRef[] = [];

    const stages: Record<string, StageState> = {};
    for (const stage of projectLevelStages()) {
      const rel = artifactPath(stage);
      const present = rel ? await this.artifactExists(rel) : false;
      if (rel) {
        artifacts.push({ path: rel, stageId: stage.id, exists: present });
      }
      stages[stage.id] = this.reconcile(
        persisted?.stages?.[stage.id],
        stage.id,
        rel,
        present
      );
    }

    const units: UnitOfWork[] = [];
    for (const unit of persisted?.units ?? []) {
      const unitStageStates: Record<string, StageState> = {};
      for (const stage of unitStages()) {
        const rel = artifactPath(stage, unit.id);
        const present = rel ? await this.artifactExists(rel) : false;
        if (rel) {
          artifacts.push({ path: rel, stageId: stage.id, exists: present });
        }
        unitStageStates[stage.id] = this.reconcile(
          unit.stages?.[stage.id],
          stage.id,
          rel,
          present
        );
      }
      units.push({
        ...unit,
        stages: unitStageStates,
        status: unit.status ?? rollUpStatus(unitStageStates),
      });
    }

    return {
      name: persisted?.name ?? root.name,
      rootPath: root.uri.fsPath,
      docsPath: docs.fsPath,
      currentPhase: persisted?.currentPhase ?? "inception",
      stages,
      units,
      artifacts,
      lastSync: persisted?.lastSync,
      jiraEpics: persisted?.jiraEpics,
      runs: persisted?.runs,
    };
  }

  private async readPersisted(): Promise<PersistedState | undefined> {
    const uri = stateUri();
    if (!uri || !(await exists(uri))) {
      return undefined;
    }
    try {
      return parsePersistedState(await readText(uri));
    } catch {
      return undefined;
    }
  }

  private async artifactExists(relative: string): Promise<boolean> {
    const uri = docsChildUri(relative);
    return uri ? exists(uri) : false;
  }

  private reconcile(
    recorded: StageState | undefined,
    stageId: string,
    rel: string | undefined,
    present: boolean
  ): StageState {
    const status = reconcileStageStatus(recorded?.status, present);
    return {
      id: stageId,
      status,
      artifactPath: present ? rel : recorded?.artifactPath,
      updatedAt: recorded?.updatedAt,
    };
  }
}
