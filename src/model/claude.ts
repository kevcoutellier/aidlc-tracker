/**
 * Types describing AI agent assets discovered in the workspace — Claude Code
 * (`.claude/`), Kiro (`.kiro/` steering, specs, hooks, settings), the AWS
 * AI-DLC rule details, Cursor and Amazon Q rules, plus cross-harness files
 * (`AGENTS.md`). Field names keep the historical `Claude*` prefix; the view
 * presents them as "Agent Assets".
 */

export type ClaudeAssetKind =
  | "agent"
  | "command"
  | "skill"
  | "memory"
  | "settings"
  | "steering"
  | "rule"
  | "spec"
  | "hook";

export interface ClaudeAsset {
  kind: ClaudeAssetKind;
  /** Display name (frontmatter `name`, folder/skill name, or file name). */
  name: string;
  description?: string;
  /** Workspace-relative path, used to open the file. */
  path: string;
  /** Short qualifier shown before the description (e.g. inclusion mode). */
  badge?: string;
}

export interface ClaudeAssets {
  hasClaude: boolean;
  /** Claude Code (`.claude/`). */
  agents: ClaudeAsset[];
  commands: ClaudeAsset[];
  skills: ClaudeAsset[];
  memory: ClaudeAsset[];
  settings: ClaudeAsset[];
  /** Kiro (`.kiro/`). */
  kiroSteering: ClaudeAsset[];
  kiroSpecs: ClaudeAsset[];
  kiroHooks: ClaudeAsset[];
  kiroSettings: ClaudeAsset[];
  /** AWS AI-DLC rule details (`.kiro/aws-aidlc-rule-details/`, `.aidlc-rule-details/`). */
  aidlcRules: ClaudeAsset[];
  /** Cursor (`.cursor/rules/`, `.cursorrules`). */
  cursorRules: ClaudeAsset[];
  /** Amazon Q (`.amazonq/rules/`). */
  amazonqRules: ClaudeAsset[];
  /** Cross-harness standard files (`AGENTS.md`). */
  shared: ClaudeAsset[];
}

export function totalClaudeAssets(a: ClaudeAssets): number {
  return (
    a.agents.length +
    a.commands.length +
    a.skills.length +
    a.memory.length +
    a.settings.length +
    a.kiroSteering.length +
    a.kiroSpecs.length +
    a.kiroHooks.length +
    a.kiroSettings.length +
    a.aidlcRules.length +
    a.cursorRules.length +
    a.amazonqRules.length +
    a.shared.length
  );
}

/**
 * Badge for a Kiro steering file: its inclusion mode from frontmatter
 * (`inclusion: always | fileMatch | manual`, with `fileMatchPattern`).
 * Undefined when no frontmatter — Kiro's default is "always".
 */
export function steeringBadge(
  data: Record<string, string>
): string | undefined {
  const inclusion = data.inclusion?.trim();
  if (!inclusion) {
    return undefined;
  }
  return inclusion === "fileMatch" && data.fileMatchPattern
    ? `fileMatch: ${data.fileMatchPattern}`
    : inclusion;
}

/**
 * Badge for a Cursor rule (`.mdc` frontmatter): how the rule is applied
 * (`alwaysApply: true`, `globs: …`, else on agent request).
 */
export function cursorRuleBadge(
  data: Record<string, string>
): string | undefined {
  if (data.alwaysApply === "true") {
    return "always";
  }
  if (data.globs) {
    return `globs: ${data.globs}`;
  }
  return undefined;
}

/** Badge for a Kiro spec: which of its documents exist. */
export function specBadge(docs: string[]): string | undefined {
  if (docs.length === 0) {
    return undefined;
  }
  return docs.map((d) => d.replace(/\.md$/i, "")).join(" · ");
}
