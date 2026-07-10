import * as vscode from "vscode";
import { SyncResult, TrackerSync, emptyResult } from "../TrackerSync";
import {
  JiraClient,
  JiraConfig,
  JiraError,
  JiraSearchIssue,
  adf,
  adfToText,
  pickDoneTransition,
} from "./JiraClient";
import { PhaseId, ProjectState, UnitOfWork } from "../../model/types";
import {
  phaseById,
  stageById,
  stagesForPhase,
  unitStages,
} from "../../model/aidlcDefinition";
import { SECRET_JIRA_TOKEN } from "../../services";

/** Maps AI-DLC phases to Jira epics and units of work to Jira issues. */
export class JiraSync implements TrackerSync {
  readonly name = "Jira";

  constructor(private readonly client: JiraClient | undefined, private readonly config: Partial<JiraConfig>) {}

  async isConfigured(): Promise<boolean> {
    return !!(
      this.client &&
      this.config.baseUrl &&
      this.config.email &&
      this.config.token &&
      this.config.projectKey
    );
  }

  /** Confirm credentials work; returns the authenticated user's display name. */
  async verify(): Promise<string> {
    this.assertClient();
    return this.client!.verify();
  }

  async push(state: ProjectState): Promise<SyncResult> {
    this.assertClient();
    const client = this.client!;
    const result = emptyResult();
    const epics: Partial<Record<PhaseId, string>> = { ...state.jiraEpics };

    // One epic per phase; construction's epic is the parent of unit issues.
    for (const phase of ["inception", "construction", "operations"] as PhaseId[]) {
      const summary = `AI-DLC ${phaseById(phase)?.name} — ${state.name}`;
      const description = this.phaseDescription(phase, state);
      if (!epics[phase]) {
        epics[phase] = await client.createIssue(
          client.baseFields(summary, description, this.config.epicIssueType!)
        );
        result.created++;
        result.messages.push(`Epic ${epics[phase]} created for ${phase}.`);
      } else {
        await client.updateIssue(epics[phase]!, { description: adf(description) });
        result.updated++;
      }
    }
    state.jiraEpics = epics;

    // Units of work -> issues under the Construction epic.
    for (const unit of state.units) {
      const description = this.unitDescription(unit);
      if (!unit.jiraKey) {
        unit.jiraKey = await this.createUnitIssue(
          unit,
          description,
          epics.construction
        );
        result.created++;
        result.messages.push(`Issue ${unit.jiraKey} created for "${unit.title}".`);
      } else {
        await client.updateIssue(unit.jiraKey, {
          summary: unit.title,
          description: adf(description),
        });
        result.updated++;
      }
    }

    state.lastSync = new Date().toISOString();
    return result;
  }

  async pull(state: ProjectState): Promise<SyncResult> {
    this.assertClient();
    const client = this.client!;
    const result = emptyResult();
    for (const unit of state.units) {
      if (!unit.jiraKey) {
        continue;
      }
      try {
        const issue = await client.getIssue(unit.jiraKey);
        unit.jiraStatus = issue.fields.status?.name;
        result.updated++;
        result.messages.push(`${unit.jiraKey}: ${unit.jiraStatus ?? "unknown"}`);
      } catch (err) {
        result.messages.push(
          `${unit.jiraKey}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    state.lastSync = new Date().toISOString();
    return result;
  }

  /**
   * Fetch existing user stories from Jira and render them as the user-stories
   * artifact (Jira is the source of truth — nothing is generated).
   */
  async importUserStories(): Promise<{ markdown: string; count: number }> {
    const jql =
      this.configuredJql("jira.storiesJql") ||
      `project = ${this.config.projectKey} AND issuetype in (Story, "Récit") ORDER BY key ASC`;
    return this.importIssues(jql, "User Stories — imported from Jira");
  }

  /**
   * Fetch requirements from Jira (Epics by default) into the requirements
   * artifact. Done items are included with their status shown; filter them out
   * via the JQL setting if you only want remaining work.
   */
  async importRequirements(): Promise<{ markdown: string; count: number }> {
    const jql =
      this.configuredJql("jira.requirementsJql") ||
      `project = ${this.config.projectKey} AND issuetype in (Epic, "Épopée") ORDER BY key ASC`;
    return this.importIssues(jql, "Requirements — imported from Jira");
  }

  /**
   * Move an issue to the "done" status category (workflow-agnostic: picks
   * whichever available transition lands in that category). Idempotent.
   */
  async transitionToDone(
    key: string
  ): Promise<
    | { outcome: "transitioned"; statusName?: string }
    | { outcome: "already-done"; statusName?: string }
    | { outcome: "no-done-transition" }
  > {
    this.assertClient();
    const client = this.client!;
    const issue = await client.getIssue(key);
    if (issue.fields.status?.statusCategory?.key === "done") {
      return { outcome: "already-done", statusName: issue.fields.status?.name };
    }
    const transition = pickDoneTransition(await client.listTransitions(key));
    if (!transition) {
      return { outcome: "no-done-transition" };
    }
    await client.doTransition(key, transition.id);
    return { outcome: "transitioned", statusName: transition.to?.name };
  }

  /**
   * Fetch open (non-Done) stories to seed Construction units of work. Each seed
   * carries its Jira key so the resulting unit is linked from the start.
   */
  async fetchUnitSeeds(): Promise<
    Array<{ key: string; summary: string; description: string; status?: string }>
  > {
    this.assertClient();
    const jql =
      this.configuredJql("jira.unitsJql") ||
      `project = ${this.config.projectKey} AND issuetype in (Story, "Récit") AND statusCategory != Done ORDER BY rank`;
    const issues = await this.client!.search(jql, [
      "summary",
      "description",
      "status",
    ]);
    return issues.map((it) => ({
      key: it.key,
      summary: it.fields.summary ?? it.key,
      description: adfToText(it.fields.description).trim(),
      status: it.fields.status?.name,
    }));
  }

  private configuredJql(key: string): string {
    return vscode.workspace.getConfiguration("aidlc").get<string>(key, "").trim();
  }

  private async importIssues(
    jql: string,
    heading: string
  ): Promise<{ markdown: string; count: number }> {
    this.assertClient();
    const issues = await this.client!.search(jql, [
      "summary",
      "description",
      "issuetype",
      "status",
      "parent",
    ]);
    return { markdown: this.formatIssues(issues, jql, heading), count: issues.length };
  }

  private formatIssues(
    issues: JiraSearchIssue[],
    jql: string,
    heading: string
  ): string {
    const lines: string[] = [`# ${heading}`, ""];
    lines.push(
      `_Source of truth: Jira. Query: \`${jql}\` — ${issues.length} issue(s)._`,
      ""
    );

    const anyParent = issues.some((it) => it.fields.parent?.key);
    if (!anyParent) {
      for (const it of issues) {
        this.appendIssue(lines, it);
      }
      return lines.join("\n");
    }

    const groups = new Map<string, { label: string; items: JiraSearchIssue[] }>();
    for (const it of issues) {
      const parentKey = it.fields.parent?.key;
      const gkey = parentKey ?? "_ungrouped";
      const label = parentKey
        ? `${parentKey} — ${it.fields.parent?.fields?.summary ?? ""}`.trim()
        : "Ungrouped";
      if (!groups.has(gkey)) {
        groups.set(gkey, { label, items: [] });
      }
      groups.get(gkey)!.items.push(it);
    }
    for (const { label, items } of groups.values()) {
      lines.push(`## ${label}`, "");
      for (const it of items) {
        this.appendIssue(lines, it);
      }
    }
    return lines.join("\n");
  }

  private appendIssue(lines: string[], it: JiraSearchIssue): void {
    lines.push(`### ${it.key} — ${it.fields.summary ?? "(no summary)"}`);
    const meta = [it.fields.issuetype?.name, it.fields.status?.name]
      .filter(Boolean)
      .join(" · ");
    if (meta) {
      lines.push(`_${meta}_`, "");
    }
    const desc = adfToText(it.fields.description).trim();
    lines.push(desc || "_(no description)_", "");
  }

  private async createUnitIssue(
    unit: UnitOfWork,
    description: string,
    epicKey: string | undefined
  ): Promise<string> {
    const client = this.client!;
    const fields: Record<string, unknown> = {
      ...client.baseFields(unit.title, description, this.config.unitIssueType!),
      labels: ["aidlc", "construction"],
    };
    if (epicKey) {
      try {
        return await client.createIssue({ ...fields, parent: { key: epicKey } });
      } catch (err) {
        if (err instanceof JiraError && err.status === 400) {
          // Parent/epic-link shape varies by Jira config; fall back without it.
          return client.createIssue(fields);
        }
        throw err;
      }
    }
    return client.createIssue(fields);
  }

  private phaseDescription(phase: PhaseId, state: ProjectState): string {
    const def = phaseById(phase);
    const lines = [def?.description ?? "", ""];
    if (phase === "construction") {
      lines.push("Units of work:");
      if (state.units.length === 0) {
        lines.push("- (none yet)");
      }
      for (const u of state.units) {
        lines.push(
          `- ${u.title} — ${u.status}${u.jiraKey ? ` (${u.jiraKey})` : ""}`
        );
      }
    } else {
      for (const s of stagesForPhase(phase).filter((x) => !x.perUnit)) {
        const st = state.stages[s.id]?.status ?? "not_started";
        lines.push(`- [${st === "complete" ? "x" : " "}] ${s.name} — ${st}`);
      }
    }
    lines.push("", "_Managed by the AIDLC Tracker extension._");
    return lines.join("\n");
  }

  private unitDescription(unit: UnitOfWork): string {
    const lines = [unit.description ?? "", "", "Construction stages:"];
    for (const s of unitStages()) {
      const st = unit.stages[s.id]?.status ?? "not_started";
      lines.push(
        `- [${st === "complete" ? "x" : " "}] ${stageById(s.id)?.name} — ${st}`
      );
    }
    lines.push("", "_Managed by the AIDLC Tracker extension._");
    return lines.join("\n");
  }

  private assertClient(): void {
    if (!this.client) {
      throw new JiraError(
        "Jira is not configured. Set base URL, email and project key in Settings, and the token via 'Set Jira Credentials'."
      );
    }
  }
}

/** Build a {@link JiraSync} from settings + SecretStorage (token). */
export async function createJiraSync(
  context: vscode.ExtensionContext
): Promise<JiraSync> {
  const cfg = vscode.workspace.getConfiguration("aidlc");
  const token = (await context.secrets.get(SECRET_JIRA_TOKEN)) ?? "";
  const config: Partial<JiraConfig> = {
    baseUrl: cfg.get<string>("jira.baseUrl", ""),
    email: cfg.get<string>("jira.email", ""),
    token,
    projectKey: cfg.get<string>("jira.projectKey", ""),
    epicIssueType: cfg.get<string>("jira.epicIssueType", "Epic"),
    unitIssueType: cfg.get<string>("jira.unitIssueType", "Task"),
  };
  const complete =
    config.baseUrl && config.email && config.token && config.projectKey;
  const client = complete ? new JiraClient(config as JiraConfig) : undefined;
  return new JiraSync(client, config);
}
