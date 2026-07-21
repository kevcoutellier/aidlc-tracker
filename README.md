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

### 🧠 Agent assets view
Surfaces the assets steering whichever agent works in this workspace — click
to open. Groups appear only when detected:
- **Claude Code** — `.claude/` agents, commands, skills, memory (`CLAUDE.md`),
  settings.
- **Kiro** — steering files (`.kiro/steering/`, with their inclusion mode:
  always / fileMatch / manual), specs (`.kiro/specs/<feature>/` requirements ·
  design · tasks), hooks, and MCP settings.
- **AI-DLC rules** — the AWS aidlc-workflows rule details
  (`.kiro/aws-aidlc-rule-details/` or `.aidlc-rule-details/`).
- **Cursor** (`.cursor/rules/*.mdc`, legacy `.cursorrules`) and
  **Amazon Q** (`.amazonq/rules/`).
- **Shared** — `AGENTS.md`, the cross-harness standard.

---

## Getting started

### Install
- **From the release** (recommended): download `aidlc-tracker.vsix` from the
  [latest release](https://github.com/kevcoutellier/aidlc-tracker/releases/latest)
  → `Extensions: Install from VSIX…` (VS Code ≥ 1.90).
- **In Kiro** (or another Code OSS fork): same `.vsix`, same
  `Extensions: Install from VSIX…` command — the extension only uses stable
  VS Code APIs. If an older Kiro build rejects the engine check
  ("not compatible with Code 0.x"), update Kiro; worst case, open the same
  folder in VS Code side by side — the tracker only *reads* the files,
  whichever agent writes them.
- **From CI**: download the `.vsix` artifact of any green
  [CI run](https://github.com/kevcoutellier/aidlc-tracker/actions) →
  `Extensions: Install from VSIX…`
- **From source**:
  ```bash
  git clone https://github.com/kevcoutellier/aidlc-tracker.git
  cd aidlc-tracker && npm install
  # press F5 in VS Code → Extension Development Host
  ```

> **Just tracking an AWS aidlc-workflows project?** No setup needed at all —
> no Anthropic key, no Jira. Install, open the folder, and the tree and
> dashboard fill in as the AWS agent works.

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
| `orchestrator.maxArtifactContextChars` | `6000` | Per-artifact excerpt cap in the generation context |
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

### Also speaks AWS aidlc-workflows

If your docs were produced by the official
[awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows) rules
(Kiro, Cursor, Claude Code, Amazon Q), the tracker follows them as-is — no
re-generation needed:

- **main layout** — per-stage subdirectories under `aidlc-docs/`
  (`inception/requirements/requirements.md`, `construction/<unit>/…`, shared
  `construction/build-and-test/`) count as stage artifacts, and units of work
  are auto-discovered from `construction/` directories.
- **v2 layout** — the most recent intent record under
  `aidlc/spaces/<space>/intents/<intent>/` is auto-detected as the docs root,
  and the checkbox stage statuses in its `aidlc-state.md` show up live in the
  tree and dashboard.

The AWS-owned `aidlc-state.md` is **never modified**: the tracker keeps its own
state in `aidlc-tracker-state.md` next to it. Setting `aidlc.docsPath`
explicitly disables the auto-detection.

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
