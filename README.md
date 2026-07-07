# AIDLC Tracker

Orchestrate, track, and sync a project through the **AI-Driven Development Life
Cycle (AI-DLC)** — **Inception → Construction → Operations** — without leaving
VS Code.

## What it does

- **Track** — an Activity Bar tree (phases → stages → units of work → artifacts)
  and a webview **dashboard** with progress bars and a units-of-work board, kept
  live by a file watcher on the `aidlc-docs/` folder.
- **Orchestrate** — step through each stage; Claude generates the artifact and
  you **review and approve** it before anything is finalized. Code generation is
  *plan-then-execute*: the `code-generation` stage produces a plan for review;
  writing source is a separate, explicit action. Three interchangeable backends
  (setting `aidlc.anthropic.authMethod`):
  - **`apiKey`** — Anthropic API key via `@anthropic-ai/sdk` (billed per use).
  - **`authToken`** — Bearer token via `@anthropic-ai/sdk` (gateways/proxies).
  - **`claudeCode`** — your **Claude subscription** via
    `@anthropic-ai/claude-agent-sdk` (runs the Claude Code CLI, using
    `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`). Requires Claude Code
    installed on the machine.
- **Sync** — push phases → **Jira** epics and units of work → Jira issues, and
  pull issue status back. A guided **Connect to Jira** flow verifies the
  connection and a status-bar item shows live state. The sync layer is pluggable
  (`TrackerSync`) so Linear / GitHub can be added later.
- **Claude-aware** — a **Claude Assets** view detects `.claude/` and `CLAUDE.md`
  and lists your agents, commands, skills, memory, and settings; click to open.

## The model

| Phase | Stages |
| --- | --- |
| **Inception** | Workspace Detection · Reverse Engineering · Requirements Analysis · User Stories · Workflow Planning · Application Design |
| **Construction** (per unit of work) | Functional Design · NFR Requirements · NFR Design · Infrastructure Design · Code Generation (plan) · Build & Test |
| **Operations** | Deployment · Monitoring *(placeholder)* |

State lives in `aidlc-docs/aidlc-state.md` (the source of truth for the tree),
with artifacts written under `inception/`, `construction/<unit>/`, and
`operations/`.

## Getting started

```bash
npm install
npm run watch      # or: npm run compile
# press F5 in VS Code to launch the Extension Development Host
```

In the dev host:

1. Open a folder and run **AIDLC: Initialize AI-DLC Project**.
2. Run **AIDLC: Set Anthropic API Key** (stored in SecretStorage).
3. Use **Run Next Stage** from the view title bar or dashboard; review the
   generated artifact, then **Approve** or **Request Changes**.
4. Add construction work with **Add Unit of Work**.
5. To sync: set `aidlc.jira.baseUrl`, `aidlc.jira.email`, `aidlc.jira.projectKey`
   in Settings and run **AIDLC: Set Jira Credentials**, then **Sync to Jira** /
   **Pull Status from Jira**.

## Commands

`Initialize AI-DLC Project` · `Run Next Stage` · `Add Unit of Work` ·
`Open Dashboard` · `Approve Artifact` · `Request Changes` · `Sync to Jira` ·
`Pull Status from Jira` · `Set Anthropic API Key` · `Set Jira Credentials` ·
`Refresh`.

## Configuration

See the **AIDLC Tracker** section in Settings (`aidlc.*`): docs path, Anthropic
model & max tokens, approval gate, and Jira base URL / email / project key /
issue types / auto-sync. Secrets (Anthropic + Jira tokens) are stored **only**
in VS Code SecretStorage.

## Development

```bash
npm run check-types   # type-check extension + webview
npm run lint          # eslint
npm test              # node:test unit suite (parser, model, serde, jira mapping)
npm run package:vsix  # build a .vsix
```

## Notes

- The Anthropic key is required for orchestration; tracking and Jira sync work
  without it.
- Jira epic/issue linking uses the `parent` field and falls back gracefully when
  a project's hierarchy differs.

## License

MIT
