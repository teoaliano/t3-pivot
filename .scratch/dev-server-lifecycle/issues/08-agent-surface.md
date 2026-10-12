# Agent surface: MCP tools for managed processes

Type: grilling
Status: resolved
Blocked-by: 01, 03

## Question

Q4 settled that agents start servers through the same managed path. This decides the
actual tool surface.

The MCP preview toolkit already exists (`apps/server/src/mcp/toolkits/preview`) with
open/navigate/click/snapshot/resize. Decide what it gains: start a session? stop one?
query status and the allocated port? attribute a port?

Decide also what an agent is told when it asks — enough to reason about ("your server is
on 5177 and it is yours") without leaking the fleet-wide picture, which findings §8 argues
should stay out of a supervising agent's context.

Open tension to resolve: if agents can also run `pnpm dev` directly in a terminal, they can
bypass allocation entirely. Decide whether that is discouraged, detected, or ignored.

---

## Carried forward from [Lease model](03-lease-model.md)

Settled: agents **auto-start** managed processes; humans do not get implicit start. What
is still open is the *mechanism*, which is this ticket's.

Decide whether an agent triggers a start implicitly by calling the existing MCP
`preview_open`, or through an explicit new tool (`managed_process_start` or similar).
Implicit keeps the agent's tool surface small but hides a potentially multi-minute compile
behind a tool that reads as cheap. Explicit is honest about cost but is one more tool to
document and for the agent to remember.

Note the agent case needs **no lease plumbing**: liveness is inferred from `activeTurnId`
and `backgroundLiveness` at sweep time, so an agent does not have to hold or release
anything. It only has to start the process and do its work.

Also settled and relevant here: agent auto-start is **uncapped**, which is the parked
capping problem now reachable with no human in the loop.

---

## Resolution

**Decided 2026-09-22.** Exactly one new MCP tool.

### What already exists

T3 exposes **21 MCP tools** across three toolkits (device, preview, pullRequests), and
**none of them runs a shell command, a script, or a terminal.** T3 has never given agents
a way to execute anything; agents use their provider's own built-in shell.

The agent's shell already runs in the right place. A provider session is started with
`cwd: resolveThreadWorkspaceCwd(...)` (`ProviderCommandReactor.ts:696-715`), which is
`worktreePath ?? project.workspaceRoot` (`checkpointing/Utils.ts:12-24`) — the same
checkout key this effort settled on. So `pnpm dev` from an agent already lands in the
correct tree.

### The hole this closes

An agent running a dev server through its own shell gets no reservation, no record, no
lifecycle and no reaping. The port is still *discovered*, because `lsof` sees any
listener, but arrives with `terminal: null` — visible to T3 and unmanageable by it.

In a fork premised on many agents working in parallel, leaving that as the agent path
would reintroduce the port collisions this whole effort prevents, through the side door.

### One tool: start

Named to match the existing convention (`preview_*`, `device_*`), gated with the existing
`requireMcpCapability` pattern (`McpInvocationContext.ts:47`).

No plumbing needed: `McpInvocationScope` already carries `threadId`
(`McpInvocationContext.ts:13-15`), so the tool resolves the caller's checkout exactly the
way everything else does.

**Deliberately not added:**

- *stop* — the reaper handles it, and an agent has no business stopping a server a human
  may be watching.
- *status* — `preview_status` and the discovered-servers list already report it.
- *wait for ready* — the agent reads the server's own ready line from the terminal, which
  is the existing working flow (see the amendment on
  [Preview binding](05-preview-binding.md)).

Rejected alternatives: adding no tools at all, which would make agent work the unmanaged
path; and adopting unmanaged servers found on our reserved range, which is inference about
processes we did not start, already ruled out by
[Attribution and FOREIGN handling](04-attribution-and-foreign.md).

### Known limitation, accepted

**An agent can still bypass the tool** by running a dev server through its own shell.
T3 does not inject instructions into the agent, so the tool description is the only thing
steering it. That is the same weakness every MCP tool here has. If agents ignore it in
practice, the fork can add project-level instructions later; nothing in this design
depends on the tool being the only path.

Also carried from [Lease model](03-lease-model.md) and unchanged: agent starts are
**uncapped**, which is the capping problem parked in
`docs/findings/dev-server-concurrency.md`, now reachable with no human in the loop.
