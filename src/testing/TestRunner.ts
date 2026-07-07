import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { AidlcServices } from "../services";
import { workspaceRoot } from "../core/paths";
import { exists, readText } from "../core/fsUtil";
import { TestRunRecord } from "../model/types";
import { parseTestOutput, testRunOk } from "./testModel";

const MAX_OUTPUT_CHARS = 2_000_000;
const MAX_HISTORY = 30;

/**
 * Runs the project's test suite (AI-DLC Build & Test) and records quantified
 * results — pass/fail/total, coverage, duration — into the tracked state.
 */
export class TestRunner {
  private readonly output: vscode.OutputChannel;
  private running = false;

  constructor(private readonly services: AidlcServices) {
    this.output = vscode.window.createOutputChannel("AIDLC Tests");
    services.context.subscriptions.push(this.output);
  }

  async run(): Promise<void> {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showErrorMessage("Open a folder to run tests.");
      return;
    }
    if (this.running) {
      void vscode.window.showWarningMessage("Tests are already running.");
      return;
    }
    const command = await this.resolveCommand(root.uri);
    if (!command) {
      const pick = await vscode.window.showWarningMessage(
        "No test command found. Set 'aidlc.test.command' (e.g. 'pnpm -r test').",
        "Open Settings"
      );
      if (pick) {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "aidlc.test.command"
        );
      }
      return;
    }

    const timeoutMs =
      Math.max(30, vscode.workspace.getConfiguration("aidlc").get<number>("test.timeoutSeconds", 900)) *
      1000;

    this.running = true;
    this.output.show(true);
    this.output.appendLine(`\n=== ${command} · ${new Date().toLocaleTimeString()} ===`);

    const at = new Date().toISOString();
    const started = Date.now();

    try {
      const { exitCode, out } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: true,
          title: `AI-DLC: running tests (${command})…`,
        },
        (_p, token) => this.spawnTests(command, root.uri.fsPath, token, timeoutMs)
      );

      const summary = parseTestOutput(out);
      const record: TestRunRecord = {
        at,
        command,
        exitCode,
        ok: testRunOk(exitCode, summary),
        durationMs: Date.now() - started,
        ...summary,
      };
      await this.persist(record);

      const detail =
        record.total !== undefined
          ? `${record.passed ?? 0}/${record.total} passed${
              record.failed ? `, ${record.failed} failed` : ""
            }${record.coveragePct !== undefined ? ` · coverage ${record.coveragePct}%` : ""}`
          : `exit code ${exitCode}`;
      this.output.appendLine(`\n— result: ${record.ok ? "PASS" : "FAIL"} · ${detail}`);
      void this.services.audit.append("tests.run", {
        command,
        result: record.ok ? "PASS" : "FAIL",
        detail,
      });
      if (record.ok) {
        void vscode.window.showInformationMessage(`Tests passed — ${detail}`);
      } else {
        void vscode.window.showErrorMessage(`Tests failed — ${detail}`, "Show Output").then((p) => {
          if (p) {
            this.output.show();
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "cancelled") {
        const record: TestRunRecord = {
          at,
          command,
          exitCode: null,
          ok: false,
          durationMs: Date.now() - started,
        };
        await this.persist(record);
        void vscode.window.showErrorMessage(`Test run failed: ${msg}`);
      } else {
        this.output.appendLine("\n— cancelled");
      }
    } finally {
      this.running = false;
    }
  }

  private spawnTests(
    command: string,
    cwd: string,
    token: vscode.CancellationToken,
    timeoutMs: number
  ): Promise<{ exitCode: number | null; out: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, { cwd, shell: true, windowsHide: true });
      let out = "";
      let settled = false;

      const append = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (out.length < MAX_OUTPUT_CHARS) {
          out += text;
        }
        this.output.append(text);
      };
      proc.stdout?.on("data", append);
      proc.stderr?.on("data", append);

      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const timer = setTimeout(() => {
        proc.kill();
        finish(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)));
      }, timeoutMs);
      token.onCancellationRequested(() => {
        proc.kill();
        finish(() => reject(new Error("cancelled")));
      });

      proc.on("error", (err) => finish(() => reject(err)));
      proc.on("close", (code) =>
        finish(() => resolve({ exitCode: code, out }))
      );
    });
  }

  private async persist(record: TestRunRecord): Promise<void> {
    const { store, writer, reload } = this.services;
    if (!store.state) {
      return;
    }
    store.update((s) => {
      s.testRuns = [record, ...(s.testRuns ?? [])].slice(0, MAX_HISTORY);
    });
    await writer.save(store.state);
    await reload();
  }

  /** Configured command, else package.json's test script via npm/pnpm/yarn. */
  private async resolveCommand(rootUri: vscode.Uri): Promise<string | undefined> {
    const configured = vscode.workspace
      .getConfiguration("aidlc")
      .get<string>("test.command", "")
      .trim();
    if (configured) {
      return configured;
    }
    try {
      const pkgUri = vscode.Uri.joinPath(rootUri, "package.json");
      if (!(await exists(pkgUri))) {
        return undefined;
      }
      const pkg = JSON.parse(await readText(pkgUri)) as {
        scripts?: Record<string, string>;
        packageManager?: string;
      };
      if (!pkg.scripts?.test) {
        return undefined;
      }
      const pm = pkg.packageManager?.startsWith("pnpm")
        ? "pnpm"
        : pkg.packageManager?.startsWith("yarn")
          ? "yarn"
          : "npm";
      return `${pm} test`;
    } catch {
      return undefined;
    }
  }
}
