import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveNpmCliJs,
  nativePackageCandidates,
  pickFromWhere,
  systemClaudeCandidates,
} from "../../src/orchestrator/claudeLocator";

test("nativePackageCandidates mirrors the SDK's probe order", () => {
  assert.deepEqual(nativePackageCandidates("win32", "x64"), [
    "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
  ]);
  assert.deepEqual(nativePackageCandidates("darwin", "arm64"), [
    "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
  ]);
  // glibc Linux probes the glibc build first, musl second — and vice versa.
  assert.deepEqual(nativePackageCandidates("linux", "x64", false), [
    "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
    "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
  ]);
  assert.deepEqual(nativePackageCandidates("linux", "x64", true), [
    "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
    "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  ]);
});

test("systemClaudeCandidates lists native-installer locations first", () => {
  assert.deepEqual(systemClaudeCandidates("win32", "C:\\Users\\kev"), [
    "C:\\Users\\kev\\.local\\bin\\claude.exe",
    "C:\\Users\\kev\\.claude\\local\\claude.exe",
  ]);
  assert.deepEqual(systemClaudeCandidates("darwin", "/Users/kev"), [
    "/Users/kev/.local/bin/claude",
    "/Users/kev/.claude/local/claude",
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ]);
});

test("pickFromWhere prefers a real .exe over an npm shim on Windows", () => {
  assert.equal(
    pickFromWhere(
      [
        "C:\\Users\\kev\\AppData\\Roaming\\npm\\claude.cmd",
        "C:\\Users\\kev\\.local\\bin\\claude.exe",
      ],
      "win32"
    ),
    "C:\\Users\\kev\\.local\\bin\\claude.exe"
  );
  // Only a shim available: returned for cli.js derivation.
  assert.equal(
    pickFromWhere(["C:\\npm\\claude.cmd"], "win32"),
    "C:\\npm\\claude.cmd"
  );
  // POSIX: first hit wins; blank lines are ignored.
  assert.equal(
    pickFromWhere(["", "/usr/local/bin/claude"], "darwin"),
    "/usr/local/bin/claude"
  );
  assert.equal(pickFromWhere([], "win32"), undefined);
});

test("deriveNpmCliJs maps a shim to the claude-code cli.js beside it", () => {
  assert.equal(
    deriveNpmCliJs("C:\\Users\\kev\\AppData\\Roaming\\npm\\claude.cmd"),
    "C:\\Users\\kev\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
  );
  assert.equal(
    deriveNpmCliJs("/usr/local/bin/claude"),
    "/usr/local/bin/node_modules/@anthropic-ai/claude-code/cli.js"
  );
  assert.equal(deriveNpmCliJs("claude.cmd"), undefined);
});
