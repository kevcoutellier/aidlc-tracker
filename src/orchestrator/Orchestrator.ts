import * as vscode from "vscode";
import { AidlcServices } from "../services";
import {
  AnthropicAuthError,
  AnthropicClient,
  GenerationCancelledError,
  GenerationTrace,
} from "./AnthropicClient";
import {
  SUBAGENT_DIRECTIVE,
  SYSTEM_PREAMBLE,
  autonomyDirective,
  instructionFor,
} from "./prompts";
import {
  artifactPath,
  stageById,
  stagesForPhase,
  unitStages,
} from "../model/aidlcDefinition";
import { rollUpStatus } from "../model/status";
import {
  PhaseId,
  ProjectState,
  StageStatus,
  UnitOfWork,
} from "../model/types";
import { docsChildUri } from "../core/paths";
import { exists, readText } from "../core/fsUtil";

interface StageRef {
  stageId: string;
  unitId?: string;
}

const MAX_ARTIFACT_CONTEXT_CHARS = 6000;

/**
 * Drop any conversational preamble an agent may emit before the document (e.g.
 * "I have enough grounding. Producing the artifact.") by starting the artifact
 * at its first markdown heading.
 */
function stripToHeading(text: string): string {
  const t = text.trim();
  if (t.startsWith("#")) {
    return t;
  }
  const m = t.match(/\n#{1,6}\s/);
  return m && m.index !== undefined ? t.slice(m.index + 1).trim() : t;
}

/**
 * Drives the AI-DLC lifecycle: computes the next actionable stage, generates its
 * artifact via the Anthropic API, and enforces human approval before a stage is
 * marked complete. Code generation is plan-then-execute: the `code-generation`
 * stage produces a plan only; writing source is a separate, explicit action.
 */
export class Orchestrator {
  private readonly output: vscode.OutputChannel;
  private busy = false;

  constructor(
    private readonly services: AidlcServices,
    private readonly client: AnthropicClient
  ) {
    this.output = vscode.window.createOutputChannel("AIDLC Orchestrator");
    services.context.subscriptions.push(this.output);
  }

  /** Compute and run the next non-complete stage in the pipeline. */
  async runNextStage(): Promise<void> {
    const state = this.services.store.state;
    if (!state) {
      void vscode.window.showErrorMessage("Initialize an AI-DLC project first.");
      return;
    }
    const next = this.computeNext(state);
    if (!next) {
      void vscode.window.showInformationMessage(
        "All AI-DLC stages are complete. 🎉"
      );
      return;
    }
    const status = this.statusOf(state, next);
    const name = stageById(next.stageId)?.name ?? next.stageId;
    if (status === "awaiting_approval") {
      void vscode.window.showInformationMessage(
        `"${name}" is awaiting your approval — approve it or request changes first.`
      );
      return;
    }
    if (status === "in_progress") {
      void vscode.window.showInformationMessage(`"${name}" is already running.`);
      return;
    }
    if (state.currentPhase === "construction" && state.units.length === 0) {
      void vscode.window.showInformationMessage(
        "Add a unit of work before running the Construction phase."
      );
      return;
    }
    await this.runStage(next.stageId, next.unitId);
  }

  /** Generate the artifact for a specific stage and gate it on approval. */
  async runStage(
    stageId: string,
    unitId?: string,
    guidance?: string
  ): Promise<void> {
    const state = this.services.store.state;
    const def = stageById(stageId);
    if (!state || !def) {
      return;
    }
    if (this.busy) {
      void vscode.window.showWarningMessage(
        "The orchestrator is already generating an artifact. Please wait."
      );
      return;
    }
    // Claim the lock synchronously — before any await — so two quick triggers
    // (e.g. double Run Next Stage) can't both pass the busy check and start
    // concurrent generations.
    this.busy = true;
    try {
      if (!(await this.ensureKey())) {
        return;
      }
      if (
        stageId === "code-generation" &&
        !(await this.confirmCodeGen(unitId))
      ) {
        return;
      }

      const rel = artifactPath(def, unitId);
      if (!rel) {
        return;
      }

      this.setStatus(stageId, unitId, "in_progress");
      await this.services.writer.save(state);

      const context = await this.gatherContext(state, stageId, unitId);
      const user = this.buildUserPrompt(stageId, unitId, guidance, context);

      this.output.show(true);
      this.output.appendLine(`\n=== ${def.name}${unitId ? ` · ${unitId}` : ""} ===`);

      const startedAt = new Date().toISOString();
      let trace: GenerationTrace | undefined;

      const cfg = vscode.workspace.getConfiguration("aidlc");
      const system =
        this.client.authMethod() === "claudeCode" &&
        cfg.get<boolean>("claudeCode.useSubagents", true)
          ? SYSTEM_PREAMBLE + SUBAGENT_DIRECTIVE
          : SYSTEM_PREAMBLE;

      const content = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: true,
          title: `AI-DLC: generating ${def.name}…`,
        },
        (_progress, token) =>
          this.client.generate({
            system,
            user,
            token,
            onDelta: (t) => this.output.append(t),
            onActivity: (line) => this.output.appendLine(`\n  ⚙ ${line}`),
            onTrace: (t) => {
              trace = t;
            },
          })
      );

      this.recordRun(stageId, unitId, startedAt, trace);

      if (!content || content.trim().length === 0) {
        this.setStatus(stageId, unitId, "blocked");
        await this.services.writer.save(state);
        await this.services.reload();
        void vscode.window.showErrorMessage(
          `${def.name}: the model returned no content.`
        );
        return;
      }

      await this.services.writer.writeArtifact(rel, stripToHeading(content));

      const requireApproval = vscode.workspace
        .getConfiguration("aidlc")
        .get<boolean>("orchestrator.requireApproval", true);

      this.setStatus(
        stageId,
        unitId,
        requireApproval ? "awaiting_approval" : "complete",
        rel
      );
      if (!requireApproval) {
        this.advancePhase(state);
      }
      await this.services.writer.save(state);
      await this.services.reload();

      const uri = docsChildUri(rel);
      if (uri) {
        await vscode.window.showTextDocument(uri, { preview: true });
      }

      void vscode.window.showInformationMessage(
        requireApproval
          ? `Generated "${def.name}". Review it, then Approve or Request Changes.`
          : `Completed "${def.name}".`
      );
    } catch (err) {
      if (err instanceof GenerationCancelledError) {
        this.setStatus(stageId, unitId, "not_started");
        await this.services.writer.save(this.services.store.state!);
        await this.services.reload();
        void vscode.window.showInformationMessage(
          `Cancelled "${def.name}".`
        );
        return;
      }
      this.setStatus(stageId, unitId, "blocked");
      await this.services.writer.save(this.services.store.state!);
      await this.services.reload();
      if (err instanceof AnthropicAuthError) {
        const { command, label } = this.credentialCommand();
        const pick = await vscode.window.showErrorMessage(err.message, label);
        if (pick) {
          await vscode.commands.executeCommand(command);
        }
      } else {
        void vscode.window.showErrorMessage(
          `Generation failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } finally {
      this.busy = false;
    }
  }

  /** Approve the artifact for a stage: mark complete and advance if possible. */
  async approve(stageId: string, unitId?: string): Promise<void> {
    const state = this.services.store.state;
    if (!state) {
      return;
    }
    const rel = artifactPath(stageById(stageId)!, unitId);
    this.setStatus(stageId, unitId, "complete", rel);
    this.advancePhase(state);
    await this.services.writer.save(state);
    await this.services.reload();
    void vscode.window.showInformationMessage(
      `Approved "${stageById(stageId)?.name ?? stageId}".`
    );
  }

  /** Request changes: collect guidance and regenerate the stage artifact. */
  async requestChanges(stageId: string, unitId?: string): Promise<void> {
    const guidance = await vscode.window.showInputBox({
      title: `Request changes — ${stageById(stageId)?.name ?? stageId}`,
      prompt: "What should change? This guidance is fed back into generation.",
      ignoreFocusOut: true,
    });
    if (!guidance) {
      return;
    }
    await this.runStage(stageId, unitId, guidance);
  }

  // --- internals -----------------------------------------------------------

  private credentialCommand(): { command: string; label: string } {
    switch (this.client.authMethod()) {
      case "authToken":
        return { command: "aidlc.setAnthropicToken", label: "Set Auth Token" };
      case "claudeCode":
        return {
          command: "aidlc.setClaudeCodeToken",
          label: "Set Claude Code Token",
        };
      default:
        return { command: "aidlc.setAnthropicKey", label: "Set API Key" };
    }
  }

  private async ensureKey(): Promise<boolean> {
    if (await this.client.hasKey()) {
      return true;
    }
    const { command, label } = this.credentialCommand();
    const pick = await vscode.window.showWarningMessage(
      "No Anthropic credential is set.",
      label
    );
    if (pick) {
      await vscode.commands.executeCommand(command);
    }
    return this.client.hasKey();
  }

  private async confirmCodeGen(unitId?: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      `Code Generation for "${unitId ?? "unit"}" produces a code plan for review. ` +
        `Writing source files is a separate, explicit step. Generate the plan now?`,
      { modal: true },
      "Generate Plan"
    );
    return pick === "Generate Plan";
  }

  private buildUserPrompt(
    stageId: string,
    unitId: string | undefined,
    guidance: string | undefined,
    context: string
  ): string {
    const autonomy = vscode.workspace
      .getConfiguration("aidlc")
      .get<"assume" | "ask">("orchestrator.autonomy", "assume");
    const parts = [instructionFor(stageId), autonomyDirective(autonomy)];
    if (unitId) {
      parts.push(`\nThis stage is for the unit of work: "${unitId}".`);
    }
    if (guidance) {
      parts.push(`\nReviewer guidance to incorporate:\n${guidance}`);
    }
    parts.push(`\n---\n# Project Context\n${context}`);
    return parts.join("\n");
  }

  private computeNext(state: ProjectState): StageRef | undefined {
    for (const ref of this.pipeline(state)) {
      if (this.statusOf(state, ref) !== "complete") {
        return ref;
      }
    }
    return undefined;
  }

  private pipeline(state: ProjectState): StageRef[] {
    const list: StageRef[] = [];
    for (const s of stagesForPhase("inception")) {
      list.push({ stageId: s.id });
    }
    for (const u of state.units) {
      for (const s of unitStages()) {
        list.push({ stageId: s.id, unitId: u.id });
      }
    }
    for (const s of stagesForPhase("operations")) {
      list.push({ stageId: s.id });
    }
    return list;
  }

  private statusOf(state: ProjectState, ref: StageRef): StageStatus {
    if (ref.unitId) {
      const unit = state.units.find((u) => u.id === ref.unitId);
      return unit?.stages[ref.stageId]?.status ?? "not_started";
    }
    return state.stages[ref.stageId]?.status ?? "not_started";
  }

  /** Persist run telemetry (newest first, capped) and log a summary line. */
  private recordRun(
    stageId: string,
    unitId: string | undefined,
    startedAt: string,
    trace: GenerationTrace | undefined
  ): void {
    const record = {
      stageId,
      unitId,
      at: startedAt,
      model: trace?.model,
      turns: trace?.turns,
      durationMs: trace?.durationMs,
      costUsd: trace?.costUsd,
      tools: trace?.tools ?? {},
      agents: trace?.agents ?? [],
    };
    this.services.store.update((s) => {
      s.runs = [record, ...(s.runs ?? [])].slice(0, 20);
    });

    const tools = Object.entries(record.tools)
      .map(([name, count]) => `${name}×${count}`)
      .join(" ");
    const parts = [
      record.model,
      record.turns !== undefined ? `${record.turns} turns` : undefined,
      record.durationMs !== undefined
        ? `${Math.round(record.durationMs / 1000)}s`
        : undefined,
      record.costUsd !== undefined
        ? `$${record.costUsd.toFixed(4)}`
        : undefined,
      tools ? `tools: ${tools}` : "no tools",
      record.agents.length ? `subagents: ${record.agents.join(", ")}` : undefined,
    ].filter(Boolean);
    this.output.appendLine(`\n— run: ${parts.join(" · ")}`);
  }

  private setStatus(
    stageId: string,
    unitId: string | undefined,
    status: StageStatus,
    artifactPathRel?: string
  ): void {
    this.services.store.update((state) => {
      const now = new Date().toISOString();
      if (unitId) {
        const unit = state.units.find((u) => u.id === unitId);
        if (!unit) {
          return;
        }
        unit.stages[stageId] = {
          id: stageId,
          status,
          artifactPath: artifactPathRel ?? unit.stages[stageId]?.artifactPath,
          updatedAt: now,
        };
        unit.status = rollUpStatus(unit.stages);
      } else {
        state.stages[stageId] = {
          id: stageId,
          status,
          artifactPath: artifactPathRel ?? state.stages[stageId]?.artifactPath,
          updatedAt: now,
        };
      }
    });
  }

  private advancePhase(state: ProjectState): void {
    const allComplete = (phase: PhaseId): boolean =>
      stagesForPhase(phase)
        .filter((s) => !s.perUnit)
        .every((s) => state.stages[s.id]?.status === "complete");

    let next: PhaseId | undefined;
    if (state.currentPhase === "inception" && allComplete("inception")) {
      next = "construction";
    } else if (
      state.currentPhase === "construction" &&
      state.units.length > 0 &&
      state.units.every((u: UnitOfWork) => u.status === "complete")
    ) {
      next = "operations";
    }
    if (next) {
      this.services.store.update((s) => {
        s.currentPhase = next!;
      });
    }
  }

  private async gatherContext(
    state: ProjectState,
    stageId: string,
    unitId?: string
  ): Promise<string> {
    const blocks: string[] = [`Project name: ${state.name}`];

    // Completed inception artifacts are always relevant context.
    for (const s of stagesForPhase("inception")) {
      const st = state.stages[s.id];
      if (st?.status === "complete" && st.artifactPath) {
        const text = await this.readArtifact(st.artifactPath);
        if (text) {
          blocks.push(`## ${s.name}\n${text}`);
        }
      }
    }

    if (unitId) {
      const unit = state.units.find((u) => u.id === unitId);
      if (unit) {
        blocks.push(
          `## Unit of Work: ${unit.title}\n${unit.description ?? "(no description)"}`
        );
        for (const s of unitStages()) {
          if (s.id === stageId) {
            break; // only earlier stages of this unit
          }
          const st = unit.stages[s.id];
          if (st?.status === "complete" && st.artifactPath) {
            const text = await this.readArtifact(st.artifactPath);
            if (text) {
              blocks.push(`### ${s.name} (this unit)\n${text}`);
            }
          }
        }
      }
    }

    return blocks.length > 1
      ? blocks.join("\n\n")
      : `${blocks[0]}\n\n(No prior artifacts yet — this is an early stage.)`;
  }

  private async readArtifact(rel: string): Promise<string | undefined> {
    const uri = docsChildUri(rel);
    if (!uri || !(await exists(uri))) {
      return undefined;
    }
    const text = await readText(uri);
    return text.length > MAX_ARTIFACT_CONTEXT_CHARS
      ? `${text.slice(0, MAX_ARTIFACT_CONTEXT_CHARS)}\n…(truncated)`
      : text;
  }
}
