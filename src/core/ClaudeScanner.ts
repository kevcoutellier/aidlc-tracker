import * as vscode from "vscode";
import { ClaudeAsset, ClaudeAssets } from "../model/claude";
import { workspaceRoot } from "./paths";
import { exists, readText } from "./fsUtil";
import { firstHeading, parseFrontmatter } from "./frontmatter";

const MD = ".md";

/** Discovers Claude Code assets (agents, commands, skills, memory, settings). */
export class ClaudeScanner {
  /** Returns undefined when neither `.claude/` nor `CLAUDE.md` is present. */
  async scan(): Promise<ClaudeAssets | undefined> {
    const root = workspaceRoot();
    if (!root) {
      return undefined;
    }
    const claudeDir = vscode.Uri.joinPath(root.uri, ".claude");
    const hasClaudeDir = await exists(claudeDir);
    const memory = await this.scanMemory(root.uri);
    if (!hasClaudeDir && memory.length === 0) {
      return undefined;
    }

    return {
      hasClaude: true,
      agents: await this.scanAgents(root.uri),
      commands: await this.scanCommands(root.uri),
      skills: await this.scanSkills(root.uri),
      memory,
      settings: await this.scanSettings(root.uri),
    };
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

  private async describe(
    uri: vscode.Uri
  ): Promise<{ name?: string; description?: string }> {
    try {
      const { data, body } = parseFrontmatter(await readText(uri));
      return {
        name: data.name,
        description: data.description ?? firstHeading(body),
      };
    } catch {
      return {};
    }
  }

  private async scanAgents(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const dir = vscode.Uri.joinPath(rootUri, ".claude", "agents");
    const out: ClaudeAsset[] = [];
    for (const [name, type] of await this.readDir(dir)) {
      if (type === vscode.FileType.File && name.endsWith(MD)) {
        const meta = await this.describe(vscode.Uri.joinPath(dir, name));
        out.push({
          kind: "agent",
          name: meta.name ?? stripExt(name),
          description: meta.description,
          path: `.claude/agents/${name}`,
        });
      }
    }
    return sortByName(out);
  }

  private async scanCommands(rootUri: vscode.Uri): Promise<ClaudeAsset[]> {
    const base = vscode.Uri.joinPath(rootUri, ".claude", "commands");
    const out: ClaudeAsset[] = [];
    const walk = async (dir: vscode.Uri, prefix: string): Promise<void> => {
      for (const [name, type] of await this.readDir(dir)) {
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          await walk(child, `${prefix}${name}/`);
        } else if (type === vscode.FileType.File && name.endsWith(MD)) {
          const meta = await this.describe(child);
          out.push({
            kind: "command",
            name: meta.name ?? `${prefix}${stripExt(name)}`,
            description: meta.description,
            path: `.claude/commands/${prefix}${name}`,
          });
        }
      }
    };
    await walk(base, "");
    return sortByName(out);
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
    const out: ClaudeAsset[] = [];
    const candidates = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"];
    for (const rel of candidates) {
      const uri = vscode.Uri.joinPath(rootUri, ...rel.split("/"));
      if (await exists(uri)) {
        let description: string | undefined;
        try {
          description = firstHeading(await readText(uri));
        } catch {
          description = undefined;
        }
        out.push({ kind: "memory", name: rel, description, path: rel });
      }
    }
    return out;
  }
}

function stripExt(name: string): string {
  return name.replace(/\.md$/i, "");
}

function sortByName(assets: ClaudeAsset[]): ClaudeAsset[] {
  return assets.sort((a, b) => a.name.localeCompare(b.name));
}
