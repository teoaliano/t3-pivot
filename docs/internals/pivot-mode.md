# Pivot mode

Pivot mode is T3 Pivot's supervision layer. A Pivot is a thread whose agent dispatches and
supervises teammates, each a thread in its own worktree. Vocabulary is in
[CONTEXT.md](../../CONTEXT.md); the spec is `docs/specs/pivot-mode.md`.

## Its records live in their own database

T3 Pivot tracks upstream's V2 schema, and upstream builds decode V2's stored events
strictly and rewrite thread rows without fields they do not know. Keeping `statev2.sqlite`
upstream-shaped keeps every upstream merge and any T3 Code pointed at the same home
working. So Pivot mode writes nothing Pivot-specific into V2's database: no event
types, no thread fields, no migrations. Its records (Pivots, teammates, decisions, wake
cursors) are event-sourced in `pivot.sqlite`, behind their own `PivotSql` tag so its
client never shadows V2's `SqlClient` (`PivotDatabase.ts`). T3 Code never opens it.

What Pivot mode does put in V2 is what V2 already models: ordinary threads, messages
sent with the Pivot as `senderThreadId`, and wake messages with a `teammate`
notification source, which builds without it decode as `background_task`.

Creating a Pivot or a teammate spans both databases. The V2 thread is created first,
then recorded; a failed record archives the thread, so no Pivot or teammate thread exists
without its record.

## Where Pivot mode reaches into V2

Kept small, and each one inert for threads that are not Pivots or teammates:

- **Teammate wakes** (`Orchestrator.ts`, `dispatchMessage`). A `teammate` notification
  is routed like a delegated task's result: steered into the running turn when the
  provider steers without interrupting tools, otherwise queued. One still queued is
  rewritten in place rather than queued twice, so changes that land before delivery reach
  the Pivot as one notice.
- **Restart carry-on** (`orchestration-v2/RestartCarryOn.ts`). Restart recovery asks
  whether a thread resumes its interrupted run whatever the continue-after-update setting
  says. The default says no; `pivot/PivotCarryOn.ts` says yes for active Pivots and live
  teammates.
- **Tool restrictions** (`orchestration-v2/ThreadToolRestrictions.ts`). A Pivot's MCP
  session gets no browser or device tools whatever the agent-access settings say: it
  supervises, and teammates verify.
- **Relay awareness** (`relay/PivotAwareness.ts`). Teammates publish no agent activity,
  and a Pivot holding an escalated decision reads as waiting for input, so mobile pushes
  it without a new phase.
- **Merge head pinning** (`PullRequestActionInput.expectedHeadSha`). The Pivot's merge
  passes the head it checked, and T3's own merge button passes the head on screen.

The Pivot and teammate tools are registered for every MCP caller, like every other
toolkit, and each call checks from `pivot.sqlite` that the caller is the active Pivot or a
live teammate. A Pivot that retires mid-session loses its tools at once.

## Wakes are derived from the log

The supervisor (`PivotSupervisor.ts`) records each teammate change it sees in V2's events
as an event in Pivot mode's log, flagged when it should wake the owning Pivot. A Pivot's
pending wake is every flagged event after its wake cursor whose teammate or decision it
owns now, so a takeover carries pending wakes with the work. The cursor advances when a
wake goes out. A wake rebuilt to join one still queued covers everything since that
wake's start (`wake_from`), not only what changed after it. Rechecks and the stuck bound
read their deadlines from the records, so nothing a restart loses is needed.

## The Pivot does not run in the project

Each project has a Pivot home under `userdata/pivot-homes/<projectId>`: a small git
repository holding the contract (`AGENTS.md`, rewritten on update), `CLAUDE.md` and the
user's `preferences.md`. The Pivot thread's workspace is the home, so the project's
instructions never load into it. The thread is created directly rather than launched: a
launch runs the project's setup script in the workspace it is given.

The Pivot reads the project and its worktrees and runs commands, but writes only
`preferences.md`. Its write scope is applied per run by `ThreadWriteAccess` (see
`PivotToolRestrictions`), and each provider adapter enforces what it can. Codex and Cursor
run the shell in their own sandbox, which confines its writes to the home. Claude, OpenCode
and ACP agents that ask T3 for permission (Grok among them) confine their edit tools to the
scope but have no sandbox for the shell, so there the contract alone keeps commands off the
project. Antigravity, Muse and Pi choose their mode from the runtime mode alone and run the
Pivot in full access. Teammates have no write scope and run in their thread's runtime mode.

Merging is the Pivot's, not its teammates': only the Pivot sees every open PR and so the
order they should land in. `PivotToolRestrictions` marks a teammate's thread
(`withoutForgeMerge`) and `ShellForgeGuard` refuses `gh pr merge|close`, `glab mr
merge|close` and the forge merge and close endpoints in its shell, pointing it at the Pivot.
The guard also covers any subagent or fork whose lineage root is a teammate or a Pivot, so
delegating the merge doesn't get around it. Only the Claude adapter enforces it, with a
`PreToolUse` hook that runs in every permission mode. Codex, Cursor, Grok, OpenCode and
Antigravity keep the contract in the teammate's instructions: teammates run in full access,
where those providers never ask T3 before a command. The guard reads one command line, so a
script file or a variable it cannot see goes unchecked, and a direct `git push` to the
default branch is left to branch protection. The Pivot's shell
is not guarded: it may merge, but its instructions allow that only after the user approved
that PR, with checks green and the reviewed head, as `merge_teammate` enforces.

A teammate's brief names its worktree path, which V2 only creates during launch
preparation. Dispatch derives the path the way V2 does and records the teammate as soon as
V2 accepts the launch, before the first run starts, so the teammate's first
`report_status` finds its record.

## A host link is full control of its machine

A Pivot on one environment (the home) starts teammates on another (the host) through a
`pivot:host` session. The host runs each teammate in full access, and on the host's own `/mcp` a
full-access thread may read any thread and target any project in that environment. So the
session's project allowlist limits which projects the RPC surface will launch into, not what a
running teammate can reach. Treat `pivot:host` as code execution as the host's server user. Do
not describe the allowlist as a sandbox, in the UI or in docs.

The user accepted this trust model for the first version, on two conditions. Wherever a host link
is created, the product says in plain words that "this gives that Pivot's agents full control of
this machine". And the home's side of dispatch, which makes a teammate run on a remote host, does
not ship until hosted teammates are contained: an MCP scope for hosted threads limited to the
teammate tools (`report_status`, `record_scout_report`, `link_pull_request`), no `t3_*`
environment or thread tools, and a write scope confined to the worktree as the Pivot's is
(`PivotToolRestrictions`).
