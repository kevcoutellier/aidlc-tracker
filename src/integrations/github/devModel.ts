/**
 * Pure (vscode-free) model + helpers for per-unit development activity:
 * commits/branches matched by Jira key, and GitHub PRs with their status.
 */

export type PrState = "open" | "merged" | "closed";
export type ChecksState = "passing" | "failing" | "pending" | "none";

export interface PrInfo {
  number: number;
  title: string;
  state: PrState;
  draft?: boolean;
  url: string;
  checks?: ChecksState;
}

export interface UnitDevInfo {
  branch?: string;
  commitCount: number;
  lastCommit?: string;
  prs: PrInfo[];
}

export interface DevActivity {
  repo?: { owner: string; name: string };
  /** Branch currently checked out in the workspace. */
  repoBranch?: string;
  /** Commits the checkout is behind origin/main, when derivable. */
  behindMain?: number;
  byUnit: Record<string, UnitDevInfo>;
  fetchedAt: string;
  error?: string;
}

/** Parse a GitHub remote URL (https or ssh) into owner/name. */
export function parseGitHubRemote(
  url: string
): { owner: string; name: string } | undefined {
  const m =
    /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  if (!m) {
    return undefined;
  }
  return { owner: m[1], name: m[2] };
}

/** Raw shape we consume from GitHub's pulls list API. */
export interface RawPull {
  number: number;
  title?: string;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  html_url?: string;
  head?: { ref?: string; sha?: string };
}

export function prState(raw: RawPull): PrState {
  if (raw.merged_at) {
    return "merged";
  }
  return raw.state === "open" ? "open" : "closed";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PRs whose title or head branch mentions the Jira key (case-insensitive),
 * bounded so NUM-12 does NOT match NUM-120 — matches feed automatic Jira
 * transitions, where a superset match would close the wrong issue.
 */
export function matchPullsToKey(pulls: RawPull[], jiraKey: string): RawPull[] {
  const re = new RegExp(`${escapeRegex(jiraKey)}(?!\\d)`, "i");
  return pulls.filter(
    (p) => re.test(p.title ?? "") || re.test(p.head?.ref ?? "")
  );
}

/**
 * A unit may auto-transition to done only when at least one of its PRs merged
 * AND none is still open — a story often spans several PRs, and the first
 * merge must not close the issue while follow-up PRs are in flight.
 */
export function readyForDoneTransition(
  prs: Array<Pick<PrInfo, "state">>
): boolean {
  return (
    prs.some((p) => p.state === "merged") &&
    prs.every((p) => p.state !== "open")
  );
}

/** Fold individual check-run conclusions into one state. */
export function summarizeChecks(
  conclusions: Array<string | null | undefined>
): ChecksState {
  if (conclusions.length === 0) {
    return "none";
  }
  if (
    conclusions.some(
      (c) => c === "failure" || c === "timed_out" || c === "cancelled"
    )
  ) {
    return "failing";
  }
  if (conclusions.some((c) => c === null || c === undefined)) {
    return "pending";
  }
  return "passing";
}
