import * as vscode from "vscode";
import {
  ArtifactRef,
  PersistedState,
  ProjectState,
  StageDefinition,
  StageState,
  StageStatus,
  UnitOfWork,
} from "../model/types";
import {
  artifactPath,
  projectLevelStages,
  unitStages,
} from "../model/aidlcDefinition";
import {
  ArtifactCandidate,
  awsCandidatesForStage,
  discoverUnitIds,
  NON_ARTIFACT_FILES,
  parseForeignStageProgress,
  unitTitleFromId,
  V2_PER_UNIT_STAGE_DIRS,
} from "../model/awsLayouts";
import {
  docsChildUri,
  docsUri,
  refreshDocsFolderDetection,
  stateUri,
  trackerStateUri,
  workspaceRoot,
} from "./paths";
import { exists, listDirectories, listMarkdownFiles, readText } from "./fsUtil";
import { parsePersistedState, STATE_BEGIN } from "./stateSerde";
import {
  reconcileObservedStatus,
  reconcileStageStatus,
  rollUpStatus,
} from "../model/status";

/** Where a stage's artifact was found on disk. */
interface ResolvedArtifact {
  /** Docs-relative path of the file to open (never a directory). */
  openPath: string;
}

/**
 * Builds {@link ProjectState} from the docs folder. Reads tracker state from
 * `aidlc-state.md` (or `aidlc-tracker-state.md` when the former is foreign)
 * and reconciles it with artifacts on disk. Artifacts are recognized in the
 * tracker's native layout and in both AWS aidlc-workflows layouts (main and
 * v2); a foreign AWS state file contributes read-only stage statuses.
 */
export class ArtifactParser {
  /** Returns undefined when there is no workspace or no docs folder. */
  async load(): Promise<ProjectState | undefined> {
    await refreshDocsFolderDetection();
    const root = workspaceRoot();
    const docs = docsUri(root);
    if (!root || !docs || !(await exists(docs))) {
      return undefined;
    }

    const { persisted, foreign } = await this.readStateFiles();
    const artifacts: ArtifactRef[] = [];

    const stages: Record<string, StageState> = {};
    for (const stage of projectLevelStages()) {
      const resolved = await this.resolveArtifact(stage, undefined);
      const nativeRel = artifactPath(stage);
      if (nativeRel) {
        artifacts.push({
          path: resolved?.openPath ?? nativeRel,
          stageId: stage.id,
          exists: resolved !== undefined,
        });
      }
      stages[stage.id] = this.reconcile(
        stage.id,
        persisted?.stages?.[stage.id],
        foreign?.get(stage.id),
        resolved
      );
    }

    const units: UnitOfWork[] = [];
    for (const unit of await this.mergeUnits(persisted)) {
      const unitStageStates: Record<string, StageState> = {};
      for (const stage of unitStages()) {
        const resolved = await this.resolveArtifact(stage, unit.id);
        const nativeRel = artifactPath(stage, unit.id);
        if (nativeRel) {
          artifacts.push({
            path: resolved?.openPath ?? nativeRel,
            stageId: stage.id,
            exists: resolved !== undefined,
          });
        }
        unitStageStates[stage.id] = this.reconcile(
          stage.id,
          unit.stages?.[stage.id],
          foreign?.get(stage.id),
          resolved
        );
      }
      units.push({
        ...unit,
        stages: unitStageStates,
        status: rollUpStatus(unitStageStates),
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
      testRuns: persisted?.testRuns,
      extensions: persisted?.extensions,
    };
  }

  /**
   * Read tracker state and, when `aidlc-state.md` belongs to a foreign tool,
   * its checkbox stage statuses. Tracker state then lives in
   * `aidlc-tracker-state.md`.
   */
  private async readStateFiles(): Promise<{
    persisted?: PersistedState;
    foreign?: Map<string, StageStatus>;
  }> {
    const primary = stateUri();
    if (!primary) {
      return {};
    }
    let persisted: PersistedState | undefined;
    let foreignText: string | undefined;
    if (await exists(primary)) {
      try {
        const text = await readText(primary);
        if (text.includes(STATE_BEGIN)) {
          persisted = parsePersistedState(text);
        } else {
          foreignText = text;
        }
      } catch {
        // Unreadable state file: fall through to artifact presence only.
      }
    }
    if (!persisted) {
      const fallback = trackerStateUri();
      if (fallback && (await exists(fallback))) {
        try {
          persisted = parsePersistedState(await readText(fallback));
        } catch {
          persisted = undefined;
        }
      }
    }
    return {
      persisted,
      foreign: foreignText
        ? parseForeignStageProgress(foreignText)
        : undefined,
    };
  }

  /** Persisted units first, then units discovered from construction/ dirs. */
  private async mergeUnits(
    persisted: PersistedState | undefined
  ): Promise<UnitOfWork[]> {
    const persistedUnits = persisted?.units ?? [];
    const known = new Set(persistedUnits.map((u) => u.id));
    const discovered = (await this.discoverUnits()).filter(
      (id) => !known.has(id)
    );
    return [
      ...persistedUnits,
      ...discovered.map((id) => ({
        id,
        title: unitTitleFromId(id),
        status: "not_started" as StageStatus,
        stages: {},
      })),
    ];
  }

  private async discoverUnits(): Promise<string[]> {
    const constructionUri = docsChildUri("construction");
    if (!constructionUri) {
      return [];
    }
    const constructionDirs = await listDirectories(constructionUri);
    const v2StageChildren: Record<string, string[]> = {};
    for (const slug of V2_PER_UNIT_STAGE_DIRS) {
      if (constructionDirs.includes(slug)) {
        v2StageChildren[slug] = await listDirectories(
          vscode.Uri.joinPath(constructionUri, slug)
        );
      }
    }
    return discoverUnitIds({ constructionDirs, v2StageChildren });
  }

  /**
   * Find the stage's artifact on disk, trying the native path first and then
   * the AWS layouts. Directory candidates count when they hold at least one
   * markdown file that is not a running log (`memory.md`).
   */
  private async resolveArtifact(
    stage: StageDefinition,
    unitId: string | undefined
  ): Promise<ResolvedArtifact | undefined> {
    const candidates: ArtifactCandidate[] = [];
    const native = artifactPath(stage, unitId);
    if (native && !native.includes("{unit}")) {
      candidates.push({ path: native, kind: "file" });
    }
    candidates.push(...awsCandidatesForStage(stage.id, unitId));

    for (const candidate of candidates) {
      const uri = docsChildUri(candidate.path);
      if (!uri) {
        continue;
      }
      if (candidate.kind === "file") {
        if (await exists(uri)) {
          return { openPath: candidate.path };
        }
        continue;
      }
      const files = (await listMarkdownFiles(uri)).filter(
        (f) => !NON_ARTIFACT_FILES.has(f.toLowerCase())
      );
      if (files.length === 0) {
        continue;
      }
      const main =
        candidate.main && files.includes(candidate.main)
          ? candidate.main
          : files[0];
      return { openPath: `${candidate.path}/${main}` };
    }
    return undefined;
  }

  /**
   * Merge our own recorded status with a foreign-observed one and artifact
   * presence. Our record wins unless it carries no signal (absent, or a
   * scaffolded `not_started` while the foreign file knows more); statuses that
   * did not come from our record are flagged transient so they are re-derived
   * each load instead of persisted.
   */
  private reconcile(
    stageId: string,
    own: StageState | undefined,
    observed: StageStatus | undefined,
    resolved: ResolvedArtifact | undefined
  ): StageState {
    const present = resolved !== undefined;
    const ownHasSignal =
      own !== undefined &&
      !(own.status === "not_started" && observed !== undefined);

    const state: StageState = ownHasSignal
      ? { id: stageId, status: reconcileStageStatus(own.status, present) }
      : {
          id: stageId,
          status: reconcileObservedStatus(observed, present),
          foreign: true,
        };
    state.artifactPath = present ? resolved.openPath : own?.artifactPath;
    state.updatedAt = own?.updatedAt;
    return state;
  }
}
