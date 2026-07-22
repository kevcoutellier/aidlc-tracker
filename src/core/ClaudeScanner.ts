import * as vscode from "vscode";
import {
  ClaudeAsset,
  ClaudeAssetKind,
  ClaudeAssets,
  cursorRuleBadge,
  specBadge,
  steeringBadge,
  totalClaudeAssets,
} from "../model/claude";
import { workspaceRoot } from "./paths";
import { exists, readText } from "./fsUtil";
import { firstHeading, parseFrontmatter } from "./frontmatter";

const MD = /\.md$/i;
const MDC = /\.(mdc|md)$/i;

/**
 * Discovers agent assets across harnesses: Claude Code (`.claude/`), Kiro
 * (`.kiro/` steering, specs, hooks, settings), the AWS AI-DLC rule details,
 * Cursor and Amazon Q rules, and cross-harness files (`AGENTS.md`).
 */
export class ClaudeScanner {
  /** Returns undefined when no assets from any harness are present. */
  async scan(): Promise<ClaudeAssets | undefined> {
    const root = workspaceRoot();
    if (!root) {
      return undefined;
    }
    const assets: ClaudeAssets = {
      hasClaude: true,
      agents: await this.scanAgents(root.uri),
      commands: await this.scanCommands(root.uri),
      skills: await this.scanSkills(root.uri),
      memory: await this.scanMemory(root.uri),
      settings: await this.scanSettings(root.uri),
      kiroSteering: await this.walkFiles(root.uri, ".kiro/steering", {
        kind: "steering",
        badge: steeringBadge,
      }),
      kiroSpecs: await this.scanKiroSpecs(root.uri),
      kiroHooks: await this.scanKiroHooks(root.uri),
      kiroSettings: await this.scanKiroSettings(root.uri),
      kiroAgents: await this.walkFiles(root.uri, ".kiro/agents", {
        kind: "agent",
      }),
      aidlcRules: [
        ...(await this.walkFiles(root.uri, ".kiro/aws-aidlc-rule-details", {
          kind: "rule",
        })),
        ...(await this.walkFiles(root.uri, ".aidlc-rule-details", {
          kind: "rule",
        })),
        // v2 (1.0) seeds ship the AI-DLC engine under <harness>/aidlc-common.
        ...(await this.walkFiles(root.uri, ".kiro/aidlc-common", {
          kind: "rule",
        })),
        ...(await this.walkFiles(root.uri, ".claude/aidlc-common", {
          kind: "rule",
        })),
      ],
      cursorRules: await this.scanCursorRules(root.uri),
      amazonqRules: await this.walkFiles(root.uri, ".amazonq/rules", {
        kind: "rule",
      }),
      shared: await this.scanShared(root.uri),
    };
    return totalClaudeAssets(assets) > 0 ? assets : undefined;
  }

  private async readDir(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return [];
    }
  }

  private async describe(uri: vscode.Uri): Promise<{
    name?: string;
    description?: string;
    data: Record<string, string>;
  }> {
    try {
      const { data, body } = parseFrontmatter(await readText(uri));
      return {
        name: data.name,
        description: data.description ?? firstHeading(body),
        data,
      };
    } catch {
      return { data: {} };
    }
  }

  /**
   * Recursively collect markdown files under a workspace-relative base dir,
   * naming nested files by their relative path.
   */
  private async walkFiles(
    rootUri: vscode.Uri,
    baseRel: string,
    opts: {
      kind: ClaudeAssetKind;
      ext?: RegExp;
      badge?: (data: Record<string, string>) => string | undefined;
    }
  ): Promise<ClaudeAsset[]> {
    const ext = opts.ext ?? MD;
    const base = vscode.Uri.joinPath(rootUri, ...baseRel.split("/"));
    const out: ClaudeAsset[] = [];
    const walk = async (dir: vscode.Uri, prefix: string): Promise<void> => {
      for (const [name, type] of await this.readDir(dir)) {
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          await walk(child, `${prefix}${name}/`);
        } else if (type === vscode.FileType.File && ext.test(name)) {
          const meta = await this.describe(child);
          out.push({
            kind: opts.kind,
            name: meta.name ?? `${prefix}${name.replace(ext, "")}`,
            description: meta.description,
            badge: opts.badge?.(meta.data),
            path: `${baseRel}/${prefix}${name}`,
          });
        }
      }
    };
    await walk(base, "");
    return sortByName(out);
  }

  private async scanAgents(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    return this.walkFiles(rootUri, ".claude/agents", { kind: "agent" });
  }

  private async scanCommands(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    return this.walkFiles(rootUri, ".claude/commands", { kind: "command" });
  }

  private async scanSkills(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const dir = vscode.Uri.joinPath(rootUri, ".claude", "skills");
    const out: ClaudeAsset[] = [];
    for (const [name, type] of await this.readDir(dir)) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }
      const skillMd = vscode.Uri.joinPath(dir, name, "SKILL.md");
      if (await exists(skillMd)) {
        const meta = await this.describe(skillMd);
        out.push({
          kind: "skill",
          name: meta.name ?? name,
          description: meta.description,
          path: `.claude/skills/${name}/SKILL.md`,
        });
      }
    }
    return sortByName(out);
  }

  private async scanSettings(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const out: ClaudeAsset[] = [];
    for (const file of ["settings.json", "settings.local.json"]) {
      const uri = vscode.Uri.joinPath(rootUri, ".claude", file);
      if (await exists(uri)) {
        out.push({ kind: "settings", name: file, path: `.claude/${file}` });
      }
    }
    return out;
  }

  private async scanMemory(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    return this.describeFiles(rootUri, ["CLAUDE.md", ".claude/CLAUDE.md"], "memory");
  }

  /** Cross-harness standard files (AGENTS.md is read by many agents). */
  private async scanShared(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    return this.describeFiles(rootUri, ["AGENTS.md"], "memory");
  }

  private async describeFiles(
    rootUri: vscode.Uri,
    candidates: string[],
    kind: ClaudeAssetKind
  ): Promise<ClaudeAsset[]> {
    const out: ClaudeAsset[] = [];
    for (const rel of candidates) {
      const uri = vscode.Uri.joinPath(rootUri, ...rel.split("/"));
      if (await exists(uri)) {
        let description: string | undefined;
        try {
          description = firstHeading(await readText(uri));
        } catch {
          description = undefined;
        }
        out.push({ kind, name: rel, description, path: rel });
      }
    }
    return out;
  }

  /** One asset per Kiro spec feature (`.kiro/specs/<feature>/`). */
  private async scanKiroSpecs(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const base = vscode.Uri.joinPath(rootUri, ".kiro", "specs");
    const out: ClaudeAsset[] = [];
    for (const [feature, type] of await this.readDir(base)) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }
      const docs: string[] = [];
      for (const doc of ["requirements.md", "design.md", "tasks.md"]) {
        if (await exists(vscode.Uri.joinPath(base, feature, doc))) {
          docs.push(doc);
        }
      }
      if (docs.length === 0) {
        continue;
      }
      const meta = await this.describe(
        vscode.Uri.joinPath(base, feature, docs[0])
      );
      out.push({
        kind: "spec",
        name: feature,
        description: meta.description,
        badge: specBadge(docs),
        path: `.kiro/specs/${feature}/${docs[0]}`,
      });
    }
    return sortByName(out);
  }

  /** Kiro agent hooks (`.kiro/hooks/*.kiro.hook`, JSON). */
  private async scanKiroHooks(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const dir = vscode.Uri.joinPath(rootUri, ".kiro", "hooks");
    const out: ClaudeAsset[] = [];
    for (const [name, type] of await this.readDir(dir)) {
      if (type !== vscode.FileType.File) {
        continue;
      }
      let display = name.replace(/\.kiro\.hook$/i, "").replace(/\.json$/i, "");
      let description: string | undefined;
      try {
        const parsed = JSON.parse(
          await readText(vscode.Uri.joinPath(dir, name))
        ) as { name?: string; description?: string };
        display = parsed.name ?? display;
        description = parsed.description;
      } catch {
        // Not JSON — keep the file name.
      }
      out.push({
        kind: "hook",
        name: display,
        description,
        path: `.kiro/hooks/${name}`,
      });
    }
    return sortByName(out);
  }

  /** Kiro settings (`.kiro/settings/*.json`, e.g. mcp.json). */
  private async scanKiroSettings(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const dir = vscode.Uri.joinPath(rootUri, ".kiro", "settings");
    const out: ClaudeAsset[] = [];
    for (const [name, type] of await this.readDir(dir)) {
      if (type === vscode.FileType.File && name.toLowerCase().endsWith(".json")) {
        out.push({
          kind: "settings",
          name,
          path: `.kiro/settings/${name}`,
        });
      }
    }
    return sortByName(out);
  }

  /** Cursor rules: `.cursor/rules/**.mdc` plus the legacy `.cursorrules`. */
  private async scanCursorRules(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const out = await this.walkFiles(rootUri, ".cursor/rules", {
      kind: "rule",
      ext: MDC,
      badge: cursorRuleBadge,
    });
    const legacy = vscode.Uri.joinPath(rootUri, ".cursorrules");
    if (await exists(legacy)) {
      out.push({
        kind: "rule",
        name: ".cursorrules",
        badge: "legacy",
        path: ".cursorrules",
      });
    }
    return out;
  }
}

function sortByName(assets: ClaudeAsset[]): ClaudeAsset[] {
  return assets.sort((a, b) => a.name.localeCompare(b.name));
}
