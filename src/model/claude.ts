/** Types describing Claude Code project assets discovered in the workspace. */

export type ClaudeAssetKind =
  | "agent"
  | "command"
  | "skill"
  | "memory"
  | "settings";

export interface ClaudeAsset {
  kind: ClaudeAssetKind;
  /** Display name (frontmatter `name`, folder/skill name, or file name). */
  name: string;
  description?: string;
  /** Workspace-relative path, used to open the file. */
  path: string;
}

export interface ClaudeAssets {
  hasClaude: boolean;
  agents: ClaudeAsset[];
  commands: ClaudeAsset[];
  skills: ClaudeAsset[];
  memory: ClaudeAsset[];
  settings: ClaudeAsset[];
}

export function totalClaudeAssets(a: ClaudeAssets): number {
  return (
    a.agents.length +
    a.commands.length +
    a.skills.length +
    a.memory.length +
    a.settings.length
  );
}
