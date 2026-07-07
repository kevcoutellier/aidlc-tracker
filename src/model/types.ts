/**
 * Core domain types for the AI-DLC (AI-Driven Development Life Cycle) tracker.
 *
 * The three phases — Inception, Construction, Operations — are fixed by the
 * methodology and described in {@link ./aidlcDefinition}. Runtime progress is
 * captured by the `*State` types below and persisted to
 * `<docsPath>/aidlc-state.md`.
 */

export type PhaseId = "inception" | "construction" | "operations";

export type StageStatus =
  | "not_started"
  | "in_progress"
  | "awaiting_approval"
  | "blocked"
  | "complete";

/** A stage in the methodology (static definition, not runtime state). */
export interface StageDefinition {
  id: string;
  name: string;
  phase: PhaseId;
  description: string;
  /**
   * Artifact this stage produces, relative to the docs folder. For per-unit
   * construction stages the literal `{unit}` token is replaced by the unit id.
   */
  artifact?: string;
  /** Construction stages run once per unit of work. */
  perUnit?: boolean;
}

export interface PhaseDefinition {
  id: PhaseId;
  name: string;
  description: string;
  stages: StageDefinition[];
}

/** Runtime status of a single stage. */
export interface StageState {
  id: string;
  status: StageStatus;
  /** Workspace-relative path of the produced artifact, when it exists. */
  artifactPath?: string;
  /** ISO-8601 timestamp of the last status change. */
  updatedAt?: string;
}

/** A construction-phase unit of work (maps to one Jira issue when synced). */
export interface UnitOfWork {
  id: string;
  title: string;
  description?: string;
  status: StageStatus;
  /** Per-unit construction stage states, keyed by stage id. */
  stages: Record<string, StageState>;
  /** Linked external tracker issue, e.g. a Jira key such as "AIDLC-42". */
  jiraKey?: string;
  /** Last-observed status name of the linked issue (populated by pull). */
  jiraStatus?: string;
}

export interface ArtifactRef {
  path: string;
  stageId?: string;
  exists: boolean;
}

/** Telemetry for one orchestrator generation: who was called, at what cost. */
export interface RunRecord {
  stageId: string;
  unitId?: string;
  /** ISO-8601 start timestamp. */
  at: string;
  model?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number;
  /** Tool name -> call count (e.g. Read: 12, Grep: 3). */
  tools: Record<string, number>;
  /** Subagent types invoked via the Task tool, if any. */
  agents: string[];
}

/** Full runtime state of the tracked project. */
export interface ProjectState {
  name: string;
  /** Absolute fs path of the workspace folder. */
  rootPath: string;
  /** Absolute fs path of the AI-DLC docs folder. */
  docsPath: string;
  currentPhase: PhaseId;
  /** Non-per-unit stage states (inception + operations), keyed by stage id. */
  stages: Record<string, StageState>;
  units: UnitOfWork[];
  artifacts: ArtifactRef[];
  /** ISO-8601 timestamp of the last successful external sync. */
  lastSync?: string;
  /** Phase -> external epic key (e.g. Jira epic). */
  jiraEpics?: Partial<Record<PhaseId, string>>;
  /** Most recent generation runs, newest first (capped). */
  runs?: RunRecord[];
}

/**
 * Persisted shape embedded in `aidlc-state.md`. Kept deliberately small and
 * derivable so the file stays human-diffable. `rootPath`/`docsPath`/`artifacts`
 * are recomputed at load time and not persisted.
 */
export interface PersistedState {
  version: 1;
  name: string;
  currentPhase: PhaseId;
  stages: Record<string, StageState>;
  units: UnitOfWork[];
  lastSync?: string;
  jiraEpics?: Partial<Record<PhaseId, string>>;
  runs?: RunRecord[];
}
