import * as vscode from "vscode";
import Anthropic from "@anthropic-ai/sdk";
import {
  SECRET_ANTHROPIC_AUTH_TOKEN,
  SECRET_ANTHROPIC_KEY,
  SECRET_CLAUDE_CODE_TOKEN,
} from "../services";
import { workspaceRoot } from "../core/paths";
import { resolveClaudeExecutable } from "./claudeLocator";

export type AuthMethod = "apiKey" | "authToken" | "claudeCode";

/** Thrown when no Anthropic credential has been configured. */
export class MissingApiKeyError extends Error {
  constructor(message?: string) {
    super(
      message ?? "No Anthropic credential set. Run 'AIDLC: Set Anthropic API Key'."
    );
    this.name = "MissingApiKeyError";
  }
}

/** Thrown when Anthropic rejects the credential (HTTP 401). */
export class AnthropicAuthError extends Error {
  constructor() {
    super(
      "Rejected credential (401). Check the API key, auth token, or Claude Code login."
    );
    this.name = "AnthropicAuthError";
  }
}

/** Thrown when the user cancels a generation. */
export class GenerationCancelledError extends Error {
  constructor() {
    super("Generation cancelled.");
    this.name = "GenerationCancelledError";
  }
}

function mapError(err: unknown): unknown {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status?: number }).status === 401
  ) {
    return new AnthropicAuthError();
  }
  return err;
}

/** Telemetry of one generation: which tools/subagents ran, at what cost. */
export interface GenerationTrace {
  model?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number;
  tools: Record<string, number>;
  agents: string[];
}

export interface GenerateOptions {
  system: string;
  user: string;
  onDelta?: (text: string) => void;
  /** Live one-line activity events, e.g. `Read · src/index.ts`. */
  onActivity?: (line: string) => void;
  /** Called once with the run's telemetry when generation settles. */
  onTrace?: (trace: GenerationTrace) => void;
  token?: vscode.CancellationToken;
}

function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "Task") {
    const sub = typeof i.subagent_type === "string" ? i.subagent_type : "agent";
    const brief = typeof i.description === "string" ? ` · ${i.description}` : "";
    return `Task → ${sub}${brief}`;
  }
  const target =
    i.file_path ?? i.pattern ?? i.path ?? i.query ?? i.command ?? i.description;
  return typeof target === "string" && target ? `${name} · ${target}` : name;
}

/**
 * Wraps the Anthropic SDK. Supports two auth methods (chosen by the
 * `aidlc.anthropic.authMethod` setting): an API key (`x-api-key`) or a Bearer
 * `authToken` (`Authorization: Bearer …`). Credentials come from SecretStorage;
 * model/limits/beta-header come from settings.
 */
export class AnthropicClient {
  constructor(private readonly context: vscode.ExtensionContext) {}

  authMethod(): AuthMethod {
    return vscode.workspace
      .getConfiguration("aidlc")
      .get<AuthMethod>("anthropic.authMethod", "apiKey");
  }

  /** True when a credential for the active auth method is available. */
  async hasKey(): Promise<boolean> {
    if (this.authMethod() === "claudeCode") {
      // Claude Code manages its own auth (a stored setup-token OR the machine's
      // existing `claude` login). Assume available; a real failure surfaces as
      // an actionable 401 at call time.
      return true;
    }
    return !!(await this.context.secrets.get(this.secretKey()));
  }

  private secretKey(): string {
    switch (this.authMethod()) {
      case "authToken":
        return SECRET_ANTHROPIC_AUTH_TOKEN;
      case "claudeCode":
        return SECRET_CLAUDE_CODE_TOKEN;
      default:
        return SECRET_ANTHROPIC_KEY;
    }
  }

  private async createClient(): Promise<Anthropic> {
    const cfg = vscode.workspace.getConfiguration("aidlc");
    const beta = cfg.get<string>("anthropic.betaHeader", "").trim();
    const baseURL = cfg.get<string>("anthropic.baseUrl", "").trim();
    const defaultHeaders = beta ? { "anthropic-beta": beta } : undefined;
    const extra = baseURL ? { baseURL } : {};

    const secret = await this.context.secrets.get(this.secretKey());
    if (!secret) {
      throw new MissingApiKeyError(
        this.authMethod() === "authToken"
          ? "No Anthropic auth token set. Run 'AIDLC: Set Anthropic Auth Token'."
          : "No Anthropic API key set. Run 'AIDLC: Set Anthropic API Key'."
      );
    }

    // For Bearer auth, pass apiKey: null so the SDK omits the x-api-key header.
    return this.authMethod() === "authToken"
      ? new Anthropic({ apiKey: null, authToken: secret, defaultHeaders, ...extra })
      : new Anthropic({ apiKey: secret, defaultHeaders, ...extra });
  }

  /** Stream a single-turn completion, returning the full text. */
  async generate(opts: GenerateOptions): Promise<string> {
    if (this.authMethod() === "claudeCode") {
      return this.generateViaClaudeCode(opts);
    }
    const client = await this.createClient();

    const cfg = vscode.workspace.getConfiguration("aidlc");
    const model = cfg.get<string>("anthropic.model", "claude-opus-4-8");
    const maxTokens = cfg.get<number>("anthropic.maxTokens", 8192);

    const startedAt = Date.now();
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });

    if (opts.token) {
      opts.token.onCancellationRequested(() => stream.abort());
    }

    let out = "";
    stream.on("text", (delta: string) => {
      out += delta;
      opts.onDelta?.(delta);
    });

    let final: Anthropic.Message;
    try {
      final = await stream.finalMessage();
    } catch (err) {
      opts.onTrace?.({
        model,
        turns: 1,
        durationMs: Date.now() - startedAt,
        tools: {},
        agents: [],
      });
      throw mapError(err);
    }
    opts.onTrace?.({
      model,
      turns: 1,
      durationMs: Date.now() - startedAt,
      tools: {},
      agents: [],
    });
    if (out.trim().length > 0) {
      return out;
    }
    // Fallback: concatenate text blocks from the final message.
    return final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  /** Cheap round-trip to confirm the credential (and model) work. */
  async verify(): Promise<void> {
    if (this.authMethod() === "claudeCode") {
      await this.generateViaClaudeCode({ system: "", user: "ping" });
      return;
    }
    const client = await this.createClient();
    const model = vscode.workspace
      .getConfiguration("aidlc")
      .get<string>("anthropic.model", "claude-opus-4-8");
    try {
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    } catch (err) {
      throw mapError(err);
    }
  }

  /**
   * Generate via the Claude Agent SDK, which drives the Claude Code CLI and
   * authenticates with the user's subscription (CLAUDE_CODE_OAUTH_TOKEN from
   * `claude setup-token`). Single-turn, no tools. Message-shape handling mirrors
   * the Agent SDK stream: text_delta events for streaming, the success `result`
   * message for the final text, and `api_error_status === 401` for auth errors.
   */
  private async generateViaClaudeCode(opts: GenerateOptions): Promise<string> {
    const query = await loadAgentSdkQuery();

    // Use a stored setup-token if present; otherwise rely on the machine's
    // existing `claude` login (do NOT override it with an empty/blank value).
    const token = await this.context.secrets.get(SECRET_CLAUDE_CODE_TOKEN);
    if (token) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    }

    const cfg = vscode.workspace.getConfiguration("aidlc");
    const model = cfg.get<string>("anthropic.model", "claude-opus-4-8");
    const execPath = cfg.get<string>("claudeCode.executablePath", "").trim();
    const maxTurns = cfg.get<number>("claudeCode.maxTurns", 12);
    const timeoutMs =
      Math.max(30, cfg.get<number>("claudeCode.timeoutSeconds", 600)) * 1000;
    const useSubagents = cfg.get<boolean>("claudeCode.useSubagents", true);

    const options: Record<string, unknown> = {
      model,
      permissionMode: "default",
      // Read-only tools so the agent can ground itself in the real workspace;
      // writing artifacts stays with the orchestrator (after human approval).
      // With subagents enabled, Task lets it consult the project's own
      // .claude/agents (loaded via settingSources) — still no write access.
      allowedTools: useSubagents
        ? ["Read", "Glob", "Grep", "Task"]
        : ["Read", "Glob", "Grep"],
      maxTurns,
      includePartialMessages: true,
    };
    if (useSubagents) {
      options.settingSources = ["user", "project"];
    }
    if (opts.system) {
      options.systemPrompt = opts.system;
    }
    if (execPath) {
      options.pathToClaudeCodeExecutable = execPath;
    } else {
      // The SDK only self-resolves its optional native package; the packaged
      // .vsix ships without it, so locate the machine's Claude Code install.
      const resolved = await resolveClaudeExecutable();
      if (resolved) {
        options.pathToClaudeCodeExecutable = resolved;
      }
    }
    // Run the agent in the project workspace, not the editor's process cwd.
    const root = workspaceRoot();
    if (root) {
      options.cwd = root.uri.fsPath;
    }

    let streamed = "";
    let finalText = "";
    let authFailed = false;
    let errored = false;
    const trace: GenerationTrace = { model, tools: {}, agents: [] };
    const startedAt = Date.now();

    const run = query({ prompt: opts.user, options });
    const cancel = () => {
      try {
        run.interrupt?.();
      } catch {
        /* best-effort cancel */
      }
    };

    // Drain the SDK stream, accumulating deltas, telemetry and the result.
    const consume = async (): Promise<void> => {
      for await (const message of run as AsyncIterable<AgentMessage>) {
        const m = message;
        if (m.type === "stream_event") {
          const ev = m.event;
          if (
            ev?.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            typeof ev.delta.text === "string" &&
            ev.delta.text.length > 0
          ) {
            streamed += ev.delta.text;
            opts.onDelta?.(ev.delta.text);
          }
        } else if (m.type === "system" && m.subtype === "init") {
          if (typeof m.model === "string") {
            trace.model = m.model;
          }
        } else if (m.type === "assistant") {
          for (const block of m.message?.content ?? []) {
            if (block.type === "tool_use" && typeof block.name === "string") {
              trace.tools[block.name] = (trace.tools[block.name] ?? 0) + 1;
              if (block.name === "Task") {
                const sub = (block.input as Record<string, unknown> | undefined)
                  ?.subagent_type;
                if (typeof sub === "string" && !trace.agents.includes(sub)) {
                  trace.agents.push(sub);
                }
              }
              opts.onActivity?.(describeToolUse(block.name, block.input));
            }
          }
        } else if (m.type === "result") {
          trace.turns = m.num_turns ?? trace.turns;
          trace.durationMs = m.duration_ms ?? Date.now() - startedAt;
          trace.costUsd = m.total_cost_usd ?? trace.costUsd;
          if (m.subtype === "success") {
            finalText = m.result ?? finalText;
          } else {
            errored = true;
            authFailed =
              m.api_error_status === 401 ||
              /401|authenticat/i.test(String(m.result ?? ""));
          }
        }
      }
    };

    // Race consumption against a timeout/cancel guard so generate() ALWAYS
    // settles within the timeout — even if the CLI subprocess never responds to
    // interrupt(). This is what prevents an indefinite "spinning" stage.
    const TIMEOUT = "__aidlc_timeout__";
    const CANCELLED = "__aidlc_cancelled__";
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new Error(TIMEOUT));
      }, timeoutMs);
      opts.token?.onCancellationRequested(() => {
        cancel();
        reject(new Error(CANCELLED));
      });
    });

    try {
      await Promise.race([consume(), guard]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === CANCELLED) {
        throw new GenerationCancelledError();
      }
      if (msg === TIMEOUT) {
        if (streamed.trim()) {
          return streamed.trim();
        }
        throw new Error(
          `Claude Code timed out after ${
            timeoutMs / 1000
          }s. Raise 'aidlc.claudeCode.timeoutSeconds', or check that Claude Code isn't stuck.`
        );
      }
      if (/401|authenticat/i.test(msg)) {
        throw new AnthropicAuthError();
      }
      if (/maximum number of turns/i.test(msg)) {
        if (streamed.trim()) {
          return streamed.trim();
        }
        throw new Error(
          "Claude Code hit the turn limit before finishing. Raise 'aidlc.claudeCode.maxTurns' in Settings."
        );
      }
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      trace.durationMs ??= Date.now() - startedAt;
      opts.onTrace?.(trace);
    }

    if (authFailed) {
      throw new AnthropicAuthError();
    }
    if (errored && !finalText && !streamed) {
      throw new Error(
        "Claude Code returned an error. Ensure Claude Code is installed and you are logged in (or set a valid token via 'claude setup-token')."
      );
    }
    return (finalText || streamed).trim();
  }
}

/** Minimal shape of the Agent SDK messages we consume. */
interface AgentMessage {
  type: string;
  subtype?: string;
  result?: string;
  api_error_status?: number;
  model?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  message?: {
    content?: Array<{ type?: string; name?: string; input?: unknown }>;
  };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
}

interface AgentQueryResult extends AsyncIterable<AgentMessage> {
  interrupt?: () => void;
}

type AgentQueryFn = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AgentQueryResult;

/** Lazily load the (ESM, external) Agent SDK; friendly error if unavailable. */
async function loadAgentSdkQuery(): Promise<AgentQueryFn> {
  try {
    const mod = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: AgentQueryFn;
    };
    return mod.query;
  } catch {
    throw new Error(
      "The Claude Code backend requires '@anthropic-ai/claude-agent-sdk' (installed with the extension) and Claude Code on the machine."
    );
  }
}
