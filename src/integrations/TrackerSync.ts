import { ProjectState } from "../model/types";

export interface SyncResult {
  created: number;
  updated: number;
  messages: string[];
}

/**
 * Pluggable external-tracker sync. Implementations map AI-DLC phases/units onto
 * a tracker (Jira today; Linear/GitHub later) and may mutate `state` in place
 * (e.g. record issue keys). The caller persists and reloads afterwards.
 */
export interface TrackerSync {
  readonly name: string;
  isConfigured(): Promise<boolean>;
  /** Push local phases/units to the tracker. Mutates `state`. */
  push(state: ProjectState): Promise<SyncResult>;
  /** Pull tracker status back into local state. Mutates `state`. */
  pull(state: ProjectState): Promise<SyncResult>;
}

export function emptyResult(): SyncResult {
  return { created: 0, updated: 0, messages: [] };
}
