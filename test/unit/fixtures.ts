import {
  ProjectState,
  StageState,
  StageStatus,
  UnitOfWork,
} from "../../src/model/types";
import {
  projectLevelStages,
  unitStages,
} from "../../src/model/aidlcDefinition";

function stageStates(
  ids: string[],
  status: StageStatus
): Record<string, StageState> {
  const out: Record<string, StageState> = {};
  for (const id of ids) {
    out[id] = { id, status };
  }
  return out;
}

export function makeUnit(
  id: string,
  title: string,
  status: StageStatus = "not_started"
): UnitOfWork {
  return {
    id,
    title,
    status,
    stages: stageStates(
      unitStages().map((s) => s.id),
      status
    ),
  };
}

/** A project with all inception stages complete and one in-progress unit. */
export function makeState(overrides: Partial<ProjectState> = {}): ProjectState {
  const inceptionIds = projectLevelStages()
    .filter((s) => s.phase === "inception")
    .map((s) => s.id);
  const opsIds = projectLevelStages()
    .filter((s) => s.phase === "operations")
    .map((s) => s.id);

  return {
    name: "demo",
    rootPath: "/tmp/demo",
    docsPath: "/tmp/demo/aidlc-docs",
    currentPhase: "construction",
    stages: {
      ...stageStates(inceptionIds, "complete"),
      ...stageStates(opsIds, "not_started"),
    },
    units: [makeUnit("auth", "Auth service", "in_progress")],
    artifacts: [],
    ...overrides,
  };
}
