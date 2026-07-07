/**
 * Pure (vscode-free) parsing of test-runner output into the quantified metrics
 * the AI-DLC Build & Test stage tracks: totals, pass/fail/skipped, coverage.
 * Recognizes node:test (TAP), Jest, Vitest, pytest and Mocha summaries, with a
 * graceful fallback to exit-code-only when no summary is found.
 */

export interface ParsedTestSummary {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  coveragePct?: number;
}

function toInt(v: string | undefined): number | undefined {
  return v === undefined ? undefined : parseInt(v, 10);
}

export function parseTestOutput(out: string): ParsedTestSummary {
  const s: ParsedTestSummary = {};

  // node:test / TAP: "# tests 41" "# pass 41" "# fail 0" "# skipped 0"
  const tapTests = /^# tests (\d+)/m.exec(out);
  if (tapTests) {
    s.total = toInt(tapTests[1]);
    s.passed = toInt(/^# pass (\d+)/m.exec(out)?.[1]);
    s.failed = toInt(/^# fail (\d+)/m.exec(out)?.[1]);
    s.skipped = toInt(/^# skipped (\d+)/m.exec(out)?.[1]);
  }

  // Jest: "Tests:       1 failed, 2 skipped, 5 passed, 8 total"
  if (s.total === undefined) {
    const jest =
      /Tests:\s+(?:(\d+) failed[,\s]*)?(?:(\d+) skipped[,\s]*)?(?:(\d+) todo[,\s]*)?(?:(\d+) passed[,\s]*)?(\d+) total/.exec(
        out
      );
    if (jest) {
      s.failed = toInt(jest[1]) ?? 0;
      s.skipped = toInt(jest[2]) ?? 0;
      s.passed = toInt(jest[4]) ?? 0;
      s.total = toInt(jest[5]);
    }
  }

  // Vitest: "Tests  3 failed | 42 passed | 1 skipped (46)"
  if (s.total === undefined) {
    const vitest =
      /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?\s*\((\d+)\)/.exec(
        out
      );
    if (vitest) {
      s.failed = toInt(vitest[1]) ?? 0;
      s.passed = toInt(vitest[2]);
      s.skipped = toInt(vitest[3]) ?? 0;
      s.total = toInt(vitest[4]);
    }
  }

  // pytest: "===== 5 passed, 1 failed, 2 skipped in 1.23s ====="
  if (s.total === undefined) {
    const pytest =
      /=+\s+(?=[^=]*(?:passed|failed))([^=]*?)\s+in\s+[\d.]+s\s+=+/.exec(out);
    if (pytest) {
      const seg = pytest[1];
      s.passed = toInt(/(\d+) passed/.exec(seg)?.[1]) ?? 0;
      s.failed = toInt(/(\d+) failed/.exec(seg)?.[1]) ?? 0;
      s.skipped = toInt(/(\d+) skipped/.exec(seg)?.[1]) ?? 0;
      s.total = s.passed + s.failed + s.skipped;
    }
  }

  // Mocha: "  12 passing (34ms)" / "  2 failing" / "  1 pending"
  if (s.total === undefined) {
    const passing = /(\d+) passing/.exec(out);
    if (passing) {
      s.passed = toInt(passing[1]);
      s.failed = toInt(/(\d+) failing/.exec(out)?.[1]) ?? 0;
      s.skipped = toInt(/(\d+) pending/.exec(out)?.[1]) ?? 0;
      s.total = (s.passed ?? 0) + s.failed + s.skipped;
    }
  }

  // Coverage — istanbul/c8 table ("All files | 85.3 | …") or "Coverage: 85%".
  const istanbul = /All files[^|]*\|\s*([\d.]+)/.exec(out);
  const genericCov = /[Cc]overage[^\d%]*([\d.]+)\s*%/.exec(out);
  const cov = istanbul?.[1] ?? genericCov?.[1];
  if (cov !== undefined) {
    s.coveragePct = parseFloat(cov);
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
