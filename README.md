# AIDLC Tracker

[![CI](https://github.com/kevcoutellier/aidlc-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/kevcoutellier/aidlc-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Orchestrate, track, and sync a software project through the
[AI-Driven Development Life Cycle](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/)
(AI-DLC) — without leaving VS Code.**

AI-DLC is AWS's methodology for AI-native development: three phases
(**Inception → Construction → Operations**), explicit stages, one unit of work
at a time, and a **human approval gate on every AI-generated artifact**. This
extension turns the methodology into a working cockpit: Claude generates the
artifacts, you review and approve, Jira stays the system of record, and every
step is measured and audited. Stage definitions, audit requirements, and the
extension rules follow [awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows).

---

## What you get

### 🗂 Lifecycle tracking
An Activity Bar tree (phases → stages → units of work) driven by the
`aidlc-docs/` folder — the durable, human-readable state (`aidlc-state.md`).
Live file watching, safe reconciliation (an artifact on disk is never hidden
behind a stale spinner), per-stage run/approve/reset actions.

### 📊 Operations-console dashboard
KPI strip (overall progress, units, pending approvals, blocked, Jira sync,
**test health**, **AI cost**), an actionable **approval queue**
(open / request changes / approve), a **live "generating now" panel** —
elapsed-vs-timeout and turns-vs-budget bars, a tool ticker, **each subagent at
work** (agent · brief · running / ✓ duration) and a Cancel button — per-unit
**pipeline segments**, and a **Recent runs** panel (model · turns · duration ·
cost · tools · subagents per generation).

### 🤖 AI orchestrator (three interchangeable backends)
Each stage's artifact is generated with full project context, then held for
your approval. Code generation is *plan-then-execute*. Pick the backend via
`aidlc.anthropic.authMethod`:

| Backend | How it authenticates | Best for |
|---|---|---|
| `apiKey` | Anthropic API key (`x-api-key`) via `@anthropic-ai/sdk` | Pay-per-use API accounts |
| `authToken` | Bearer token via `@anthropic-ai/sdk` (+ optional custom `baseUrl`) | Corporate LLM gateways/proxies |
| `claudeCode` | **Your Claude subscription** via `@anthropic-ai/claude-agent-sdk` (runs the Claude Code CLI) | Claude Pro/Max users — no API key |

The `claudeCode` backend runs **read-only** in your workspace (Read/Glob/Grep)
to ground artifacts in real code, and can **delegate to your project's own
Claude Code subagents** (`.claude/agents`, e.g. a security-engineer) via the
Task tool — invocations are traced and credited in a "Contributors" line.

### ⇢ Code-plan → Claude Code handoff
The plugin never writes source code — implementation belongs to a Claude Code
session working under your repository's own conventions and gates. Once a
unit's code plan is **approved**, *Hand Off to Claude Code* (tree ⇢, dashboard
row, palette) writes a committed, auditable brief
(`construction/<unit>/handoff.md`: mission, artifacts to read, branch name,
commit/PR rules, definition of done) and offers to **launch a Claude Code
terminal session on it** (or copy the prompt). The dashboard then tracks the
resulting branch/PRs/checks by the unit's Jira key, and auto-transition closes
the loop when the PRs settle.

### 🔄 Jira as the source of truth
- Guided **Connect to Jira** flow + status-bar indicator with quick actions.
- **Pull**: import Requirements (Epics/Épopées), User Stories (Story/Récit),
  and **seed Construction units of work from open stories** — each unit linked
  by its Jira key. English and French Jira instances handled out of the box;
  every import is JQL-overridable.
- **Push**: phases → epics, units → issues; pull issue status back anytime.

### ⧟ Dev activity per unit
Matched by Jira key: local commits and branches (git), plus GitHub **PRs with
open/merged/closed state and check status**, clickable through to GitHub. Uses
VS Code's built-in GitHub session — no extra token.

### 🧪 Test monitoring & KPIs
**Run Project Tests** executes your test command (auto-detected or
`aidlc.test.command`), parses **node:test / Jest / Vitest / pytest / Mocha**
summaries plus istanbul/c8 coverage, and keeps a capped history — shown as a
pass-rate bar strip and a click-to-run KPI. Mirrors the quantified metrics of
the AI-DLC *Build & Test* stage.

### ▤ Append-only audit log
`aidlc-docs/audit.md` journals every significant event with ISO-8601
timestamps: generations (model, turns, cost, subagents), approvals, change
requests (**your guidance quoted verbatim, never summarized**), resets, Jira
syncs/imports, test runs, extension changes.

### 🛡 Opt-in AI-DLC extensions
The AWS extension registry, enforced at generation time: **Security Baseline**
(SECURITY-01…15), **Resiliency Baseline** (RESILIENCY-01…15), and
**Property-Based Testing**. Enabled extensions inject their rules into matching
stages and every artifact must end with a per-rule compliance section
(compliant / non-compliant / N/A) — non-compliance is a blocking finding.

### 🧠 Claude assets view
Detects `.claude/` and `CLAUDE.md` and lists the workspace's agents, commands,
skills, memory, and settings — click to open.

---

## Getting started

### Install
- **From CI**: download the `.vsix` artifact of any green
  [CI run](https://github.com/kevcoutellier/aidlc-tracker/actions) →
  `Extensions: Install from VSIX…`
- **From source**:
  ```bash
  git clone https://github.com/kevcoutellier/aidlc-tracker.git
  cd aidlc-tracker && npm install
  # press F5 in VS Code → Extension Development Host
  ```

### Set up (once per machine)
1. Pick an AI backend:
   - Subscription: run `claude setup-token` in a terminal, then
     **AIDLC: Use Claude Code / Subscription (set token)** — or choose
     *Use my existing Claude Code login*.
   - API key: **AIDLC: Set Anthropic API Key** (key from console.anthropic.com).
2. **AIDLC: Connect to Jira** — site URL → email → project key → API token.
   Credentials are verified immediately and stored in **SecretStorage** only.

### Drive a project
1. Open your project folder → **AIDLC: Initialize AI-DLC Project**
   (non-destructive; existing progress is preserved).
2. *Brownfield with Jira?* Import instead of generating:
   **Import Requirements from Jira**, **Import User Stories from Jira**,
   **Create Units of Work from Jira** (open stories → linked units).
3. **Run Next Stage** — review the generated artifact, then **Approve** or
   **Request Changes** (your feedback is fed back into regeneration).
4. When a unit's code plan is approved, **Hand Off to Claude Code** — the
   implementation session works on its own branch, under your repo's gates.
5. Open the **Dashboard** to steer: approval queue, pipelines, dev activity,
   tests, costs.
6. **Sync to Jira** whenever you want the board to reflect reality.

---

## Configuration (`aidlc.*`)

| Setting | Default | Purpose |
|---|---|---|
| `docsPath` | `aidlc-docs` | Workspace-relative artifacts folder |
| `anthropic.authMethod` | `apiKey` | `apiKey` · `authToken` · `claudeCode` |
| `anthropic.model` | `claude-opus-4-8` | Model id used for generation |
| `anthropic.maxTokens` | `8192` | Max output tokens (raw-SDK backends) |
| `anthropic.baseUrl` / `anthropic.betaHeader` | — | Gateway endpoint / `anthropic-beta` header |
| `claudeCode.useSubagents` | `true` | Allow delegation to `.claude/agents` via Task |
| `claudeCode.maxTurns` / `timeoutSeconds` | `12` / `600` | Agent loop bounds |
| `claudeCode.executablePath` | auto | Claude Code binary (auto-detected when empty) |
| `orchestrator.requireApproval` | `true` | Human gate on every artifact |
| `orchestrator.autonomy` | `assume` | `assume` (stated assumptions) or `ask` (open questions) |
| `test.command` / `test.timeoutSeconds` | auto / `900` | Test suite command and bound |
| `jira.baseUrl` · `email` · `projectKey` | — | Jira Cloud connection (token via command) |
| `jira.epicIssueType` / `unitIssueType` | `Epic` / `Task` | Issue types used on push |
| `jira.requirementsJql` · `storiesJql` · `unitsJql` | bilingual defaults | Override any import query |
| `jira.autoSync` | `false` | Push to Jira on every state change |
| `jira.autoTransition` | `true` | Move an issue to Done once its PRs settle (≥1 merged, none open) |

## Key commands

`Initialize AI-DLC Project` · `Run Next Stage` · `Hand Off to Claude Code` ·
`Open Dashboard` ·
`Connect to Jira` · `Sync to Jira` / `Pull Status from Jira` ·
`Import Requirements / User Stories from Jira` · `Create Units of Work from Jira` ·
`Run Project Tests` · `Refresh Dev Activity` · `Configure AI-DLC Extensions` ·
`Open Audit Log` · `Set Anthropic API Key` / `Set Anthropic Auth Token` /
`Use Claude Code / Subscription`.

## The `aidlc-docs/` folder

```
aidlc-docs/
├── aidlc-state.md          # tracked progress — human-readable + machine block
├── audit.md                # append-only audit journal
├── inception/              # requirements, user stories, workflow plan, design
├── construction/<unit>/    # per-unit designs, code plan, handoff brief, build & test notes
├── operations/             # deployment, monitoring
└── rules/                  # methodology rules + enabled extension rules
```

Files are the state: everything is diffable, reviewable, and survives reloads.

## Security posture

- Secrets (Anthropic, Jira) live **only** in VS Code SecretStorage.
- The generation agent is **read-only** in your workspace; artifact writes go
  through your explicit approval, and code generation requires a second gate.
- The dashboard webview is CSP-hardened (no inline script/style, command
  allowlist, validated external URLs).

## Development

```bash
npm run check-types   # tsc (extension + webview)
npm run lint          # eslint
npm test              # node:test unit suite
npm run compile       # esbuild → dist/
npm run package:vsix  # build the .vsix
```

CI runs the same gates on every push/PR and publishes the `.vsix` artifact.

## License

[MIT](LICENSE)
