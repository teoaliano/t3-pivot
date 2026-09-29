# Map: Pivot mode

Label: `wayfinder:map`
Effort: `pivot-mode`
Charted: 2026-09-29

## Destination

One implementable spec for **Pivot mode**. A project gets a Pivot, an agent thread the
user talks to. The Pivot dispatches teammates into their own worktrees, supervises them,
escalates only the decisions the user must make, and lands their work on the user's word.
The Pivot view shows it all on desktop and web. Reached when every decision below is made
and `to-spec` can synthesize without an interview.

## Notes

**Domain.** T3 Pivot is a fork of T3 Code (`pingdotgg/t3code`) that adds firstmate's
(`kunchenguid/firstmate`) crew-supervision model. Reference clones:
`~/.cache/t3-pivot-refs/{t3code,firstmate}`. The firstmate clone has full history and
was fast-forwarded to upstream `c5f48e4` on 2026-09-29. Fetch before copying a rule. The
triage findings cite the older `a09090d`, so recheck a cited line before relying on it.
Vocabulary lives in `CONTEXT.md`: Pivot, teammate, Pivot view, Pivot mode. firstmate's
"first mate", "crewmate" and "captain" map to Pivot, teammate and user.

**Skills every session should consult:** `grilling` + `domain-modeling` (default),
`codebase-design` for seam and interface questions.

**Where durable decisions go.** Prose under `docs/internals/`, as the managed-processes
effort did. Tickets stay the working record and the map stays an index.

### Standing rule: firstmate is the reference design

Pivot mode is built natively in T3, and firstmate is the design it copies, not a
dependency. Every ticket starts from what firstmate does for that decision (its status
grammar, brief sections, hard rules, escalation format) and adopts it unless T3 already
does the job. Name the firstmate source a resolution copies, the T3 code it reuses, and
anything net-new with the reason nothing existing serves.

**Working order: look first, ask second.** Before grilling on a ticket, establish what T3
and firstmate already do for it. Only put to the user what is left over. This rule comes
from the managed-processes map, where two tickets in a row proposed mechanisms the
codebase already had.

### Settled at charting

- **Native, not hosted.** firstmate does not run inside T3. Hosting it unchanged would
  leave teammate status and task contracts in firstmate's files, which the Pivot view
  would have to scrape. It would also load firstmate's whole contract on every Pivot turn
  (6,845 words upstream, 11,473 in the stale clone), much of it for terminals T3
  replaces. The cost is known: firstmate's upstream fixes stop flowing in, so they get
  ported by hand.
- **Exact mechanics in the server, judgment in the Pivot.** firstmate's own rule, with
  T3's event-sourced server as the script layer.
- **One Pivot per project.** Cross-project dispatch is deferred.
- **Pivot harnesses: Claude Code, Codex, Cursor.** Teammates can run on any provider T3
  runs.
- **T3 wakes the Pivot** by starting a turn on its thread. None of firstmate's
  per-harness Stop hooks or bash watcher.
- **Teammate chat is read-only in the Pivot view,** except for answering a pending
  approval, which T3 reports to the Pivot. Steering goes through the Pivot.
- **The Pivot view has no sidebar.** In the default view, teammates appear in the
  sidebar grouped under their Pivot.
- **Upstream-shaped code.** Keep pulling T3 Code. New code in new modules, small edits to
  hot files (`ChatView.tsx`, `ws.ts`).
- **The whole model in one spec,** not a thin slice first.

### Facts from charting exploration

- No parent/child, delegation or supervisor concept exists in T3's contracts or server.
  Agents cannot create threads, read other threads, or subscribe to events.
- Thread-with-worktree creation is `thread.turn.start` with `bootstrap`
  (`packages/contracts/src/orchestration.ts:1286-1333`), run by `dispatchBootstrapTurnStart`,
  a closure inside the WS handler (`apps/server/src/ws.ts:1080`). A server-side caller
  would need it lifted into a service.
- Thread shells carry `session.status`, `latestTurn.state`, `hasPendingApprovals`,
  `hasPendingUserInput`, `backgroundLiveness`, `pullRequests`
  (`orchestration.ts:887-947`). Reactors subscribe to domain events
  (`ThreadSettlementReactor.ts:334` is the pattern).
- The per-thread MCP server (`apps/server/src/mcp/`) scopes a bearer token to one thread
  and gates toolkits by capability (`McpInvocationContext.ts:13-20`,
  `ProviderService.ts:906-914`).
- Mobile push already flows from `AgentAwarenessRelay.ts` through `infra/relay`.
- firstmate specifies a GUI backend acceptance contract in
  `docs/codex-app-backend.md`: create, send, bounded read plus live state, archive.

## Decisions so far

<!-- one line per closed ticket -->

- [firstmate contract triage](issues/01-firstmate-contract-triage.md): seven native
  mechanics, a Pivot contract of about 2,000 to 2,500 words, and the reference clone is
  156 commits stale.

## Not yet specified

- **Mobile Pivot view.** Undesigned. Graduates into a prototype ticket once the desktop
  layout and the teammate card settle, since those decide what mobile renders.
- **The Pivot's durable preferences.** firstmate keeps `captain.md` and `learnings.md`
  so preferences survive a restart. Whether the Pivot needs its own store, or provider
  memory and project files cover it, depends on what the contract ticket keeps.
- **"Do X when Y" watches.** firstmate lets the first mate arm a watch that acts when a
  condition lands (`state/when/`). Unclear yet whether the Pivot needs this beyond wakes.
- **Connection modes.** The Pivot runs server-side, so remote and tunnel clients should
  work unchanged. Revisit if any decision puts Pivot state on a client.

## Out of scope

- **Standing autonomy** (firstmate's `+yolo`, merging green work without asking). Can
  return later as a per-project setting.
- **no-mistakes validation.** An external pipeline. The delivery gate uses CI on the
  linked PR instead.
- **Backlog of undispatched work.** The Pivot's chat and open decisions cover it.
- **Away modes** (`/afk`, `/quiet`, the digest daemon). T3 notifications and mobile push
  cover being away.
- **Nested supervisors, remote hosts, Relay (X/Discord), voice, mail.**
- **Cross-project dispatch.** One Pivot per project for now.
- **Dispatch capping.** Parked in `docs/findings/dev-server-concurrency.md`. The Pivot
  never throttles on host capacity itself (findings §8), so capping lands in the
  allocator whenever it comes, and the Pivot only sees a "queued" outcome. Pivot mode
  makes the §7 measurements takeable, because it produces real fleets.
