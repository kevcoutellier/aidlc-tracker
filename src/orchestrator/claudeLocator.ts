import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

/**
 * Locates the Claude Code executable for the `claudeCode` backend.
 *
 * The Agent SDK has NO fallback of its own: when `pathToClaudeCodeExecutable`
 * is not set it only resolves its optional platform package
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`, a ~230 MB binary) and
 * throws if that package is absent. The packaged .vsix ships the SDK but NOT
 * the platform binary, so the extension must find the machine's own Claude
 * Code install (native installer or npm global) and pass it explicitly.
 */

/** Module subpaths of the SDK's native binary, in the SDK's own probe order. */
export function nativePackageCandidates(
  platform: string,
  arch: string,
  musl = false
): string[] {
  const base = "@anthropic-ai/claude-agent-sdk";
  const exe = platform === "win32" ? ".exe" : "";
  const names =
    platform === "linux"
      ? musl
        ? [`${base}-linux-${arch}-musl`, `${base}-linux-${arch}`]
        : [`${base}-linux-${arch}`, `${base}-linux-${arch}-musl`]
      : [`${base}-${platform}-${arch}`];
  return names.map((n) => `${n}/claude${exe}`);
}

/** Well-known absolute install locations of Claude Code, most specific first. */
export function systemClaudeCandidates(
  platform: string,
  home: string
): string[] {
  if (platform === "win32") {
    return [
      `${home}\\.local\\bin\\claude.exe`, // native installer
      `${home}\\.claude\\local\\claude.exe`, // legacy migrate-installer
    ];
  }
  return [
    `${home}/.local/bin/claude`, // native installer
    `${home}/.claude/local/claude`, // legacy migrate-installer
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
}

/**
 * Pick the most spawnable entry from `where`/`which` output. On Windows a
 * `.cmd`/`.ps1` npm shim cannot be spawned directly by the SDK (no shell), so
 * a real `.exe` wins; a shim is returned only for cli.js derivation.
 */
export function pickFromWhere(
  lines: string[],
  platform: string
): string | undefined {
  const paths = lines.map((l) => l.trim()).filter(Boolean);
  if (paths.length === 0) {
    return undefined;
  }
  if (platform !== "win32") {
    return paths[0];
  }
  return paths.find((p) => /\.exe$/i.test(p)) ?? paths[0];
}

/**
 * Map an npm global shim (e.g. `…\npm\claude.cmd`) to the real JS entrypoint
 * (`…\npm\node_modules\@anthropic-ai\claude-code\cli.js`) — the SDK spawns
 * `.js` entrypoints via node, which works where spawning a shim does not.
 */
export function deriveNpmCliJs(shimPath: string): string | undefined {
  const m = /^(.*)[\\/][^\\/]+$/.exec(shimPath);
  if (!m) {
    return undefined;
  }
  const sep = shimPath.includes("\\") ? "\\" : "/";
  return [m[1], "node_modules", "@anthropic-ai", "claude-code", "cli.js"].join(
    sep
  );
}

function whereClaude(platform: string): Promise<string[]> {
  const cmd = platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(cmd, ["claude"], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? [] : String(stdout).split(/\r?\n/));
    });
  });
}

/** True when the SDK can resolve its own native binary (dev host / full install). */
function sdkNativeBinaryAvailable(): boolean {
  const req = createRequire(__filename);
  for (const candidate of nativePackageCandidates(
    process.platform,
    process.arch
  )) {
    try {
      if (existsSync(req.resolve(candidate))) {
        return true;
      }
    } catch {
      /* not installed — keep probing */
    }
  }
  return false;
}

/**
 * Resolve what to pass as `pathToClaudeCodeExecutable`.
 *
 * Returns `undefined` when the SDK's own native binary is installed (let the
 * SDK resolve it, exactly as before). Otherwise returns the machine's Claude
 * Code executable, or throws an actionable error when none can be found.
 */
export async function resolveClaudeExecutable(): Promise<string | undefined> {
  if (sdkNativeBinaryAvailable()) {
    return undefined;
  }

  for (const candidate of systemClaudeCandidates(process.platform, homedir())) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const found = pickFromWhere(await whereClaude(process.platform), process.platform);
  if (found) {
    if (process.platform !== "win32" || /\.exe$/i.test(found)) {
      return found;
    }
    // Windows npm shim: spawn the real cli.js instead.
    const cliJs = deriveNpmCliJs(found);
    if (cliJs && existsSync(cliJs)) {
      return cliJs;
    }
  }

  throw new Error(
    "Claude Code executable not found on this machine. Install Claude Code " +
      "(https://claude.com/claude-code) or set 'aidlc.claudeCode.executablePath'."
  );
}
