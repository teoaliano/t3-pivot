# Pivot mode

Pivot mode is T3 Pivot's supervision layer. A Pivot is a thread whose agent dispatches and
supervises teammates, each a thread in its own worktree. Vocabulary is in
[CONTEXT.md](../../CONTEXT.md). The spec is `docs/specs/pivot-mode.md`. The code is in
`apps/server/src/pivot/`, the Pivot and teammate MCP tools in
`apps/server/src/mcp/toolkits/pivot/`, and the client logic in
`packages/client-runtime/src/pivotState.ts` and `apps/web/src/components/pivot/`.

## Its records live in their own database

T3 Pivot shares `~/.t3/userdata` and `statev2.sqlite` with the T3 Code (Nightly) app,
which decodes V2's stored events strictly and rewrites thread rows without fields it
does not know. So Pivot mode writes nothing Pivot-specific into V2's database: no event
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

A teammate's brief names its worktree path, which V2 only creates during launch
preparation. Dispatch derives the path the way V2 does and records the teammate as soon as
V2 accepts the launch, before the first run starts, so the teammate's first
`report_status` finds its record.
