import * as vscode from "vscode";
import { git } from "../../core/gitExec";
import { workspaceRoot } from "../../core/paths";
import { UnitOfWork } from "../../model/types";
import {
  DevActivity,
  PrInfo,
  RawPull,
  UnitDevInfo,
  matchPullsToKey,
  parseGitHubRemote,
  prState,
  summarizeChecks,
} from "./devModel";

const MAX_CHECKED_PRS = 6;

/**
 * Collects per-unit development activity: local commits/branches matched by the
 * unit's Jira key, and GitHub PRs (state + checks) from the workspace's origin
 * remote. GitHub calls use VS Code's built-in GitHub session when available
 * (public repos work unauthenticated, rate-limited).
 */
export class DevActivityService {
  /** interactive=true may prompt the user to sign in to GitHub. */
  async collect(units: UnitOfWork[], interactive: boolean): Promise<DevActivity> {
    const root = workspaceRoot();
    const fetchedAt = new Date().toISOString();
    if (!root) {
      return { byUnit: {}, fetchedAt, error: "No workspace folder open." };
    }
    const cwd = root.uri.fsPath;

    const activity: DevActivity = { byUnit: {}, fetchedAt };

    activity.repoBranch =
      (await git(["branch", "--show-current"], cwd).catch(() => "")) ||
      undefined;
    const behindRaw = await git(
      ["rev-list", "--count", "HEAD..origin/main"],
      cwd
    ).catch(() => undefined);
    if (behindRaw !== undefined && Number.isFinite(parseInt(behindRaw, 10))) {
      activity.behindMain = parseInt(behindRaw, 10);
    }

    // Local git is the baseline — works with no remote at all.
    const keyed = units.filter((u) => u.jiraKey);
    for (const unit of keyed) {
      activity.byUnit[unit.id] = await this.localInfo(cwd, unit.jiraKey!);
    }

    // GitHub layer (PRs + checks) — best-effort on top.
    try {
      const remote = await git(["remote", "get-url", "origin"], cwd).catch(
        () => ""
      );
      const repo = parseGitHubRemote(remote);
      if (!repo) {
        activity.error = remote
          ? "origin is not a GitHub remote — PR tracking skipped."
          : "No git remote 'origin' — PR tracking skipped.";
        return activity;
      }
      activity.repo = repo;

      const token = await this.gitHubToken(interactive);
      const pulls = await this.listPulls(repo, token);
      for (const unit of keyed) {
        const matched = matchPullsToKey(pulls, unit.jiraKey!);
        const prs: PrInfo[] = [];
        for (const raw of matched.slice(0, MAX_CHECKED_PRS)) {
          const state = prState(raw);
          prs.push({
            number: raw.number,
            title: raw.title ?? `#${raw.number}`,
            state,
            draft: raw.draft,
            url: raw.html_url ?? "",
            checks:
              state === "open" && raw.head?.sha
                ? await this.checks(repo, raw.head.sha, token)
                : undefined,
          });
        }
        activity.byUnit[unit.id].prs = prs;
      }
    } catch (err) {
      activity.error = `GitHub: ${err instanceof Error ? err.message : String(err)}`;
    }
    return activity;
  }

  private async localInfo(cwd: string, key: string): Promise<UnitDevInfo> {
    const info: UnitDevInfo = { commitCount: 0, prs: [] };
    try {
      // --all: units are developed on feature branches/worktrees — the main
      // checkout's HEAD alone would miss most of their commits.
      const log = await git(
        ["log", "--all", "--oneline", "-i", `--grep=${key}`, "-n", "200"],
        cwd
      );
      const lines = log ? log.split("\n").filter(Boolean) : [];
      info.commitCount = lines.length;
      info.lastCommit = lines[0]?.replace(/^\S+\s+/, "");
    } catch {
      /* not a git repo or git unavailable — leave zeros */
    }
    try {
      const branches = await git(
        ["branch", "--all", "--list", `*${key}*`, "--list", `*${key.toLowerCase()}*`],
        cwd
      );
      const first = branches
        .split("\n")
        .map((b) => b.replace(/^\*?\s+/, "").replace(/^remotes\//, ""))
        .filter(Boolean)[0];
      info.branch = first;
    } catch {
      /* ignore */
    }
    return info;
  }

  private async gitHubToken(interactive: boolean): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        "github",
        ["repo"],
        interactive ? { createIfNone: true } : { silent: true }
      );
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  private async gh<T>(path: string, token: string | undefined): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${path} → ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private listPulls(
    repo: { owner: string; name: string },
    token: string | undefined
  ): Promise<RawPull[]> {
    return this.gh<RawPull[]>(
      `/repos/${repo.owner}/${repo.name}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      token
    );
  }

  private async checks(
    repo: { owner: string; name: string },
    sha: string,
    token: string | undefined
  ): Promise<PrInfo["checks"]> {
    try {
      const res = await this.gh<{
        check_runs?: Array<{ conclusion?: string | null }>;
      }>(
        `/repos/${repo.owner}/${repo.name}/commits/${sha}/check-runs?per_page=50`,
        token
      );
      return summarizeChecks((res.check_runs ?? []).map((c) => c.conclusion));
    } catch {
      return undefined;
    }
  }
}

/** In-memory store for the latest dev-activity snapshot. */
export class DevActivityStore implements vscode.Disposable {
  private _activity: DevActivity | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<
    DevActivity | undefined
  >();
  readonly onDidChange = this._onDidChange.event;

  get activity(): DevActivity | undefined {
    return this._activity;
  }

  set(activity: DevActivity): void {
    this._activity = activity;
    this._onDidChange.fire(activity);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
