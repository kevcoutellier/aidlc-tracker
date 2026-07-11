# Change Log

All notable changes to the AIDLC Tracker extension are documented here.

## [0.0.1] - Unreleased

### Fixed
- **The packaged .vsix now ships a working `claudeCode` backend.** The Agent
  SDK is esbuild-`external` (ESM, spawns the Claude Code CLI) but both
  packaging paths excluded `node_modules` entirely, so any installed .vsix
  threw "requires '@anthropic-ai/claude-agent-sdk'" at first generation — only
  the F5 dev host worked. Packaging now runs with dependency traversal and a
  targeted `.vscodeignore` (SDK in, its ~230 MB per-platform native binaries
  and runtime-unused peers out → 1.1 MB .vsix), and CI fails if the SDK is
  missing from the artifact. Because the SDK has no fallback of its own when
  its native binary package is absent, the extension now locates the machine's
  Claude Code install (native installer paths, `where`/`which`, npm-shim →
  `cli.js`) and passes it as `pathToClaudeCodeExecutable`;
  `aidlc.claudeCode.executablePath` still overrides.
- **Auto-transition waits for ALL of a unit's PRs to settle.** A Jira issue is
  now moved to done only when at least one matched PR merged AND none is still
  open — previously the first merged PR closed issues whose remaining PRs were
  still in flight (common when a story spans several PRs).
- **Narration can no longer be saved as an artifact.** A generation whose
  output contains no markdown heading (a budget-exhausted run that only
  streamed its exploration narration) is now blocked with guidance to raise
  `claudeCode.maxTurns`/`timeoutSeconds`, instead of writing the narration to
  the artifact file.
- **Branch awareness.** Generations record the workspace branch (audit + run
  history) and warn when the checkout is behind origin/main; the dashboard's
  Construction header shows `⎇ branch (−N vs main)`; per-unit commit counting
  now scans all branches/worktrees (`git log --all`), not just HEAD.
- **Monorepo test totals.** The test-output parser now aggregates EVERY
  framework summary in the output (one Vitest/Jest/TAP/pytest summary per
  workspace under `pnpm -r test`) instead of reading only the first, and
  averages coverage across multiple istanbul tables. Mocha's loose pattern
  stays a fallback to avoid double counting.
- **Finished-but-spinning stages recover.** On load, a stage recorded as
  `in_progress` whose artifact already exists on disk is surfaced as
  `awaiting_approval` (the approve action) instead of a stuck spinner.
- **Agent preamble stripped.** Generated artifacts start at their first markdown
  heading, dropping any conversational lead-in the agent emitted.
- **No concurrent runs.** The orchestrator now claims its busy lock
  synchronously (before any await), so two quick triggers can't both start a
  generation — which previously left multiple stages stuck spinning at once.
- **Generation can never hang.** The Claude Code backend now races stream
  consumption against a timeout/cancel guard, so a stage always settles (and its
  spinner clears) within `aidlc.claudeCode.timeoutSeconds` even if the CLI
  subprocess never responds to interrupt. Cancelling resets the stage to
  not_started. Combined with the startup reset of stale `in_progress` and the
  per-stage Reset action, Inception stages can't get stuck spinning.

### Changed
- **Dashboard redesigned as an operations console** — masthead with phase
  stepper, KPI strip (overall %, units, approvals, blocked, Jira sync), an
  actionable approval queue (open / approve / request changes), a "generating
  now" rail, and a units-of-work table with per-stage pipeline segments and
  clickable Jira keys.

### Added
- **Code-plan → Claude Code handoff** — the bridge from design to
  implementation. Once a unit's code plan is approved, "Hand Off to Claude
  Code" (unit ⇢ in the tree and dashboard, or the palette) writes a committed
  brief at `construction/<unit>/handoff.md` — mission, approved artifacts in
  read order (code plan first), dedicated branch name
  (`feature/<KEY>-<slug>`), commit/PR rules (repo conventions win; never
  merge), definition of done — then offers to launch a `claude` terminal
  session pointed at the brief, or to copy the shell-safe prompt. Audited as
  `unit.handoff` / `unit.handoff.launch`. Together with dev-activity tracking
  and settle-gated auto-transition, this closes the monitor→pilot loop: the
  plugin designs and gates, a Claude Code session implements, the dashboard
  watches the PR to done.
- **Automatic Jira transitions** — when monitoring (or a manual dev refresh)
  detects a merged PR for a unit, its linked Jira issue is transitioned to the
  done status category (workflow-agnostic, FR/EN safe: picked by category, not
  name). Gated by `aidlc.jira.autoTransition` (default on), deduplicated per
  session, audited (`jira.transition[.error]`) and announced. PR↔key matching
  is now word-bounded so NUM-12 can never close on NUM-120's PR.
- **Passive monitoring** — `aidlc.monitor.intervalMinutes` (default 5) silently
  refreshes dev activity (commits/PRs/checks) and pulls Jira statuses on an
  interval, so the console mirrors development that happens entirely outside
  the plugin (agent sessions, bot PRs, auto-merge, CI). 0 disables;
  `aidlc.monitor.pullJira` opts the Jira pull out.
- **Auto-approve unit pipeline** — "Run Unit Pipeline (auto-approve)" (tree ▶▶,
  dashboard row hover, palette) runs every remaining stage of a unit
  sequentially without per-stage approval gates (code-gen confirmation
  included), stopping on the first non-complete stage. Fully audited
  (`unit.pipeline.start/complete/aborted`).
- **Append-only audit log** (`aidlc-docs/audit.md`, per awslabs/aidlc-workflows)
  — every significant event is journaled with an ISO-8601 timestamp: generation
  start/complete/error/cancel (with model, turns, cost, subagents), approvals,
  change requests (raw guidance verbatim, never summarized), stage resets, unit
  additions, Jira sync/imports, test runs, extension changes. "Open Audit Log"
  command + dashboard button.
- **AI-DLC extensions (opt-in)** mirroring the AWS registry: Security Baseline
  (SECURITY-01…15), Resiliency Baseline (RESILIENCY-01…15), Property-Based
  Testing. Enabled via "Configure AI-DLC Extensions" (or the masthead chips);
  each enabled extension injects its rules into matching stages, mandates a
  per-rule compliance section (compliant / non-compliant / N/A) in artifacts,
  and writes a self-documenting rule file under `aidlc-docs/rules/extensions/`.
- **Test monitoring & KPIs** (aligned with the AI-DLC Build & Test stage from
  awslabs/aidlc-workflows) — "Run Project Tests" executes the configured test
  command (`aidlc.test.command`, auto-detects the package.json test script),
  streams output to an "AIDLC Tests" channel, parses node:test/Jest/Vitest/
  pytest/Mocha summaries plus istanbul coverage, and persists a capped history.
  The dashboard gains a Tests KPI (pass/total + coverage, click to run), an AI
  generation KPI (total cost/runs), and a Tests panel with a pass-rate history
  bar strip.
- **Dev activity per unit** — the dashboard's units table gains a Dev column:
  commits and branch matched by the unit's Jira key (local git), plus GitHub
  PRs with state (open/merged/closed) and check status for open PRs, clickable
  to GitHub. Uses VS Code's built-in GitHub session when available; refreshes
  on dashboard open and via "Refresh Dev Activity".
- **Project subagents at work** — generations can now delegate to the
  workspace's own Claude Code agents (`.claude/agents`) via the Task tool
  (`aidlc.claudeCode.useSubagents`, default on; project settings loaded via
  `settingSources`). At most 2 focused subagent calls per artifact; artifacts
  end with a "Contributors" line and invocations appear live in the output
  channel (`Task → security-engineer · …`) and in Recent runs. Default
  generation timeout raised to 600s to give assisted runs headroom.
- **Run telemetry** — every generation records which tools the agent used
  (Read/Glob/Grep call counts), any subagents invoked via Task, the model,
  turns, duration, and cost. Live tool activity streams into the "AIDLC
  Orchestrator" output channel; the last 20 runs persist in `aidlc-state.md`
  and the dashboard shows a "Recent runs" panel.
- **Tracker core** — AI-DLC domain model, artifact parser, project store, file
  watcher, and Activity Bar tree view (phases → stages → units → artifacts) with
  status icons. Project initialization scaffolds `aidlc-docs/`.
- **Dashboard** — webview with phase/overall progress bars, a units-of-work
  board, and quick actions (message-passing, CSP-hardened).
- **Orchestrator** — Anthropic-backed stage generation with a human approval
  gate at every step; per-stage prompt templates; plan-then-execute gating for
  code generation. Keys stored in SecretStorage.
- **Jira sync** — pluggable `TrackerSync` with a Jira REST v3 client mapping
  phases → epics and units of work → issues, plus status pull-back.
- **Import user stories / requirements from Jira** — pull existing Jira issues
  (JQL, ADF→text, grouped by epic) into `inception/user-stories.md` and
  `inception/requirements.md` instead of generating them. Configurable via
  `aidlc.jira.storiesJql` / `aidlc.jira.requirementsJql` (add
  `AND statusCategory != Done` to exclude completed items); available from the
  matching tree row, the Jira menu, and the command palette.
- **Create Construction units of work from Jira** — seed units from open
  (non-Done) Jira stories, each linked by `jiraKey` so sync/pull work
  immediately. Idempotent (updates existing by key), writes `workflow-plan.md`
  and completes Workflow Planning. Configurable via `aidlc.jira.unitsJql`.
- Unit tests (`node:test`), ESLint flat config, and `.vsix` packaging.
- **Claude Assets view** — detects `.claude/` and `CLAUDE.md` and lists agents,
  commands, skills, memory, and settings (with descriptions from frontmatter);
  click to open. Live-updates via a `.claude/**` watcher.
- **Live Jira connection** — guided *Connect to Jira* flow (site URL → email →
  project key → token) that verifies the connection, plus a status-bar indicator
  and quick-actions menu.
- **Anthropic auth methods** — three interchangeable backends via
  `aidlc.anthropic.authMethod`: `apiKey` (`x-api-key`) and `authToken` (Bearer)
  through `@anthropic-ai/sdk`, and **`claudeCode`** through
  `@anthropic-ai/claude-agent-sdk` — which runs the Claude Code CLI and uses your
  **Claude subscription** (`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`).
  Set via *Set Anthropic API Key* / *Set Anthropic Auth Token* / *Use Claude Code
  (set token)*. Credentials are verified on save; an optional custom base URL and
  `anthropic-beta` header are supported.
