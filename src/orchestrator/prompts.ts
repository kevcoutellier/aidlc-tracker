/**
 * Per-stage prompt templates for the AI-DLC orchestrator. Bundled as strings so
 * they are always available at runtime (no packaged asset reads). Each stage
 * contributes an `instruction`; a shared system preamble frames the role.
 */

export const SYSTEM_PREAMBLE = `You are an expert software architect and engineer executing the AI-Driven Development Life Cycle (AI-DLC).
You produce one focused artifact at a time. A human reviews and approves every artifact before the process advances.

Work efficiently:
- Stay focused on the current task. If you inspect the workspace, look only at source and config files relevant to it.
- NEVER read node_modules, package lockfiles, build output (dist/build/.next/out), coverage, or .git. Prefer a quick Glob/Grep over exhaustive reading. Keep tool use minimal — a handful of targeted lookups, not a full crawl.

Output rules:
- Return a single, well-structured GitHub-flavored Markdown document.
- Start directly with a level-1 heading. Do NOT wrap the whole document in a code fence and do NOT add conversational preamble or sign-off.
- Prefer concrete, actionable content over generalities.`;

/** Appended to the system prompt when project subagents are enabled. */
export const SUBAGENT_DIRECTIVE = `

Project subagents: this workspace may define specialized agents under .claude/agents (e.g. security-engineer, compliance-officer, ux-designer, design-reviewer). When the stage's subject clearly matches such an agent's expertise, you MAY delegate a focused sub-analysis or review to it via the Task tool — at most 2 subagent calls per artifact, each with a short, specific brief.

Subagents start with NO context from this conversation: they see only the brief you write. Every brief MUST therefore (1) list the workspace-relative paths of the upstream AI-DLC artifacts relevant to the delegated question — copy them from the "Artifact files on disk" section of the project context — and (2) instruct the subagent to READ those files before analyzing. A brief without artifact paths wastes the delegation.

Incorporate their findings into the artifact and end the document with a "Contributors" line naming the subagents consulted (or omit the line if none were).`;

/** Directive appended per the `aidlc.orchestrator.autonomy` setting. */
export function autonomyDirective(mode: "assume" | "ask"): string {
  return mode === "ask"
    ? `Where information is genuinely missing, list it under an "Open Questions" section for the human to answer.`
    : `Proceed autonomously. Do NOT ask the user to answer questions. When information is missing, make a reasonable, clearly-stated decision and record it under an "Assumptions" section. Produce a complete, usable artifact that can move forward as-is.`;
}

const INSTRUCTIONS: Record<string, string> = {
  "workspace-detection": `Produce a **Workspace Analysis**. Summarize the project's current state from the provided context: languages, frameworks, entry points, build/test tooling, and notable folders. If the workspace is empty or greenfield, say so and note the implied starting point.`,

  "reverse-engineering": `Produce **Reverse-Engineering Notes**. Recover the existing architecture from the context: components/services, their responsibilities, key dependencies, data stores, and integration points. Include a Mermaid component diagram if structure is discernible. For greenfield projects, state that there is no existing system to recover and outline expected components instead.`,

  "requirements-analysis": `Produce a **Requirements** document. Capture functional and non-functional requirements, in-scope vs out-of-scope, constraints, and assumptions. Number the requirements (FR-1, NFR-1, …) so later stages can reference them. Surface ambiguities under "Open Questions".`,

  "user-stories": `Produce **User Stories** derived from the requirements. Use the "As a <role>, I want <goal>, so that <benefit>" form, each with a short list of acceptance criteria and a reference to the requirement id(s) it satisfies. Group by user role or capability.`,

  "workflow-planning": `Produce a **Workflow Plan** that breaks the work into a sequenced set of **units of work** suitable for the Construction phase. For each unit give: a short id-friendly title, a one-line goal, the user stories/requirements it covers, and dependencies on other units. End with a recommended build order.`,

  "application-design": `Produce a **High-Level Application Design**: the target architecture, major components and their responsibilities, key interactions/data flow, technology choices with rationale, and cross-cutting concerns (auth, config, observability). Include a Mermaid diagram of the component/interaction model.`,

  "functional-design": `Produce a **Functional Design** for THIS unit of work only. Detail the behavior: interfaces/APIs, inputs/outputs, core logic, states, edge cases, and error handling. Keep it scoped to the unit; reference the application design rather than restating it.`,

  "nfr-requirements": `Produce an **NFR Requirements** assessment for THIS unit: performance, scalability, availability, security, privacy, compliance, observability, and operational constraints that apply. Quantify targets where possible (e.g., p99 latency, RPS, RPO/RTO).`,

  "nfr-design": `Produce an **NFR Design** for THIS unit: the architectural patterns and technology selections that satisfy the NFR requirements, with trade-offs and rationale. Map each significant decision back to the NFR it addresses.`,

  "infrastructure-design": `Produce an **Infrastructure Design** for THIS unit: required compute, storage, networking, and managed services; environment/config needs; and a deployment topology. Include IaC guidance (resources to provision) without generating full templates.`,

  "code-generation": `Produce a **Code Plan** for THIS unit (planning only — no application source is written yet). List the files to create or modify with their purpose, the key functions/types and their signatures, the order of implementation, and the tests to add. This plan is the approval gate before any code is generated.`,

  "build-test": `Produce a **Build & Test** plan/report for THIS unit: how to build it, the test strategy (unit/integration/e2e), specific test cases mapped to acceptance criteria, and the commands to run. Note any validation gaps.`,

  deployment: `Produce a **Deployment** plan: environments, release/rollout strategy, configuration and secrets handling, migration steps, and rollback procedure.`,

  monitoring: `Produce a **Monitoring & Observability** plan: key metrics/SLOs, logging and tracing, dashboards, and alerting rules with thresholds.`,
};

/**
 * Extract the artifact from model output: drop any conversational preamble
 * before the first markdown heading. Returns null when the output contains no
 * heading at all — i.e. the model spent its budget exploring and never wrote
 * the document; such output must never be saved as an artifact.
 */
export function stripToHeading(text: string): string | null {
  const t = text.trim();
  if (t.startsWith("#")) {
    return t;
  }
  const m = t.match(/\n#{1,6}\s/);
  return m && m.index !== undefined ? t.slice(m.index + 1).trim() : null;
}

/** Instruction text for a stage, or a generic fallback. */
export function instructionFor(stageId: string): string {
  return (
    INSTRUCTIONS[stageId] ??
    `Produce the artifact for the "${stageId}" stage of the AI-DLC methodology based on the provided context.`
  );
}
