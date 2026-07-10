/**
 * Pure (vscode-free) parsing of test-runner output into the quantified metrics
 * the AI-DLC Build & Test stage tracks: totals, pass/fail/skipped, coverage.
 * Recognizes node:test (TAP), Jest, Vitest, pytest and Mocha summaries — and
 * AGGREGATES every summary found, so monorepo runs (e.g. `pnpm -r test`
 * printing one Vitest summary per workspace) report whole-suite totals rather
 * than the first package's. Falls back to exit-code-only when no summary is
 * found.
 */

export interface ParsedTestSummary {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  coveragePct?: number;
}

interface Counts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

function n(v: string | undefined): number {
  return v === undefined ? 0 : parseInt(v, 10);
}

/**
 * Strict per-framework matchers (safe to sum across frameworks in the same
 * output). Mocha's loose "N passing" pattern is handled separately as a
 * fallback to avoid double counting.
 */
const MATCHERS: Array<{
  regex: RegExp;
  extract: (m: RegExpMatchArray) => Counts;
}> = [
  {
    // node:test / TAP block: "# tests 41 … # pass 40 … # fail 1 [… # skipped 0]"
    regex:
      /^# tests (\d+)[\s\S]*?^# pass (\d+)[\s\S]*?^# fail (\d+)(?:[\s\S]*?^# skipped (\d+))?/gm,
    extract: (m) => ({
      total: n(m[1]),
      passed: n(m[2]),
      failed: n(m[3]),
      skipped: n(m[4]),
    }),
  },
  {
    // Jest: "Tests:       1 failed, 2 skipped, 5 passed, 8 total"
    regex:
      /Tests:\s+(?:(\d+) failed[,\s]*)?(?:(\d+) skipped[,\s]*)?(?:(\d+) todo[,\s]*)?(?:(\d+) passed[,\s]*)?(\d+) total/g,
    extract: (m) => ({
      failed: n(m[1]),
      skipped: n(m[2]),
      passed: n(m[4]),
      total: n(m[5]),
    }),
  },
  {
    // Vitest: "Tests  3 failed | 42 passed | 1 skipped (46)"
    regex:
      /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?\s*\((\d+)\)/g,
    extract: (m) => ({
      failed: n(m[1]),
      passed: n(m[2]),
      skipped: n(m[3]),
      total: n(m[4]),
    }),
  },
  {
    // pytest: "===== 5 passed, 1 failed, 2 skipped in 1.23s ====="
    regex: /=+\s+((?:\d+ \w+(?:, )?)+)\s+in\s+[\d.]+s\s+=+/g,
    extract: (m) => {
      const seg = m[1];
      const passed = n(/(\d+) passed/.exec(seg)?.[1]);
      const failed = n(/(\d+) failed/.exec(seg)?.[1]);
      const skipped = n(/(\d+) skipped/.exec(seg)?.[1]);
      return { passed, failed, skipped, total: passed + failed + skipped };
    },
  },
];

export function parseTestOutput(out: string): ParsedTestSummary {
  const s: ParsedTestSummary = {};
  const acc: Counts = { passed: 0, failed: 0, skipped: 0, total: 0 };
  let found = false;

  for (const { regex, extract } of MATCHERS) {
    for (const m of out.matchAll(regex)) {
      const c = extract(m);
      if (c.total === 0 && c.passed + c.failed + c.skipped === 0) {
        continue;
      }
      found = true;
      acc.passed += c.passed;
      acc.failed += c.failed;
      acc.skipped += c.skipped;
      acc.total += c.total;
    }
  }

  // Mocha fallback ("12 passing" / "2 failing" / "1 pending") — loose pattern,
  // only trusted when no strict framework summary matched.
  if (!found) {
    const sum = (re: RegExp) =>
      [...out.matchAll(re)].reduce((a, m) => a + n(m[1]), 0);
    const passing = sum(/(\d+) passing/g);
    if ([...out.matchAll(/(\d+) passing/g)].length > 0) {
      found = true;
      acc.passed = passing;
      acc.failed = sum(/(\d+) failing/g);
      acc.skipped = sum(/(\d+) pending/g);
      acc.total = acc.passed + acc.failed + acc.skipped;
    }
  }

  if (found) {
    s.passed = acc.passed;
    s.failed = acc.failed;
    s.skipped = acc.skipped;
    s.total = acc.total;
  }

  // Coverage — istanbul/c8 "All files | 85.3 | …" tables (averaged across
  // workspaces) or a generic "Coverage: 85%" line.
  const tables = [...out.matchAll(/All files[^|]*\|\s*([\d.]+)/g)].map((m) =>
    parseFloat(m[1])
  );
  if (tables.length > 0) {
    s.coveragePct =
      Math.round((tables.reduce((a, b) => a + b, 0) / tables.length) * 10) / 10;
  } else {
    const generic = /[Cc]overage[^\d%]*([\d.]+)\s*%/.exec(out);
    if (generic) {
      s.coveragePct = parseFloat(generic[1]);
    }
  }

  return s;
}

/** Success = exit 0, or a parsed summary with zero failures. */
export function testRunOk(
  exitCode: number | null,
  summary: ParsedTestSummary
): boolean {
  if (exitCode === 0) {
    return true;
  }
  return summary.total !== undefined && (summary.failed ?? 0) === 0;
}
