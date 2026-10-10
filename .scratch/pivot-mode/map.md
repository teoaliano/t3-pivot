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

**Standing preference: only drifts go to the user** (set 2026-09-29). Anything that copies
firstmate's behavior is approved in advance. Adopt it and record the source. Put to the
user only the places a resolution drifts from firstmate, with the reason. A new mechanism
that keeps firstmate's guarantee (a T3 event replacing a firstmate file) is not a drift.
A change in what the user, the Pivot or a teammate experiences is.

**Standing preference: build only what the user can test** (set 2026-09-29). Where T3
supports more platforms than firstmate (forges, providers), new Pivot logic covers what
firstmate covers, and the rest stays manual.

### Settled at charting

- **Native, not hosted.** firstmate does not run inside T3. Hosting it unchanged would
  leave teammate status and task contracts in firstmate's files, which the Pivot view
  would have to scrape. It would also load firstmate's whole contract on every Pivot turn
  (6,845 words upstream, 11,473 in the stale clone), much of it for terminals T3
  replaces. The cost is known: firstmate's upstream fixes stop flowing in, so they get
  ported by hand.
- **Exact mechanics in the server, judgment in the Pivot.** firstmate's own rule, with
  T3's event-sourced server as the script layer.
- **One active Pivot per project.** Cross-project dispatch is deferred. (Amended: a new
  Pivot takes over from the active one, which retires. See the model ticket.)
- **Pivot harnesses: Claude Code, Codex, Cursor.** Teammates can run on any provider T3
  runs.
- **T3 wakes the Pivot** by starting a turn on its thread. None of firstmate's
  per-harness Stop hooks or bash watcher.
- **Teammate chat is read-only in the Pivot view,** except for answering a pending
  approval, which T3 reports to the Pivot. Steering goes through the Pivot. (Amended by
  steering: the default view's sidebar lets the user type to a teammate directly.)
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
- [Pivot and teammate in the orchestration model](issues/02-pivot-and-teammate-model.md):
  a teammate is a thread with a `teammate` field owned by one Pivot thread; a Pivot is a
  permanent thread kind, one active per project, and a new Pivot takes over the active
  one's live teammates, which retires it (amended after entering and leaving).
- [Teammate status: vocabulary and who reports it](issues/03-teammate-status.md): the
  teammate reports firstmate's six verbs through an MCP tool, T3 derives the runtime
  state, and one shared function combines them into eight statuses, scoped to the turn.
- [Waking the Pivot](issues/07-waking-the-pivot.md): a reactor wakes the Pivot on
  terminal and attention statuses, batched over 30 s, never mid-turn, as a visible
  collapsed notice, acknowledged by a cursor that advances when the wake turn completes.
- [Decisions: escalating to the user](issues/08-decisions.md): one project-owned
  decision record, answered by the Pivot within firstmate's authority rule or held for the
  user, closed only by an answer, a teammate's own cleared blocker, or a labeled moot.
- [Dispatch and the brief](issues/04-dispatch-and-brief.md): the worktree bootstrap
  moves into a server service, the server renders firstmate's brief as the teammate's
  first Pivot-marked message, on an immutable `pivot/<slug>` branch.
- [Steering a teammate](issues/06-steering.md): firstmate's queue, control verbs and
  intent rule, plus two drifts: a steer delivery, and direct typing from the sidebar that
  wakes the Pivot.
- [What the Pivot can read about a teammate](issues/05-what-the-pivot-reads.md): three
  bounded read tools copying firstmate's crew-state line, peek and status log, plus direct
  worktree reads, scoped to its own teammates.
- [Delivery gate and merge](issues/09-delivery-and-merge.md): firstmate's direct-PR
  and local-only modes, `done` needs a pushed PR, merge on recorded approval at a pinned
  head; drift: the Pivot merges on GitHub and GitLab only.
- [Teardown and what counts as landed](issues/10-teardown.md): firstmate's landed test
  and refusals, run by the Pivot on landed work; drift: a torn-down teammate can be
  reopened for reading.
- [After a restart](issues/11-after-a-restart.md): firstmate's non-event restart and
  in-place relaunch; drifts: the server resumes interrupted teammates itself, and relaunch
  resumes the conversation.
- [Where the Pivot runs and what it may touch](issues/12-where-the-pivot-runs.md): its
  own home, a git repo per project holding the contract, as firstmate's first mate runs in
  its home; read-only by contract; Pivot and teammate capabilities split.
- [Which Pivot events notify the user](issues/18-notifications.md): only the Pivot
  notifies, only for firstmate's escalate-now list; teammate threads go quiet.
- [Entering and leaving Pivot mode](issues/13-entering-and-leaving.md): option B, a
  Pivot is permanent, "New Pivot" takes over the active one's teammates and retires it,
  a Chat / Pivot view switch in the header, compaction for full contexts.
- [Pivot view layouts](issues/15-pivot-view-layouts.md): composable panes on a layout
  tree with presets, card context menus instead of focus, a finished chip, and a
  per-device wallpaper with no blur.
- [Expanded teammate](issues/17-expanded-teammate.md): no separate state; the Teammate,
  Diff, Files and Preview panes, opened from the card's menu.
- [Teammate card](issues/16-teammate-card.md): status top left, actions top right,
  title, PR or "Scout" bottom left, provider bottom right; no motion, stable order.
- [The Pivot's contract](issues/14-pivot-contract.md): firstmate's judgment text under
  a 3,000-word ceiling in the Pivot home's `AGENTS.md`, situational skills attached to
  wakes; drifts: no "captain", and the user's own rules in `preferences.md`.

## Not yet specified

Empty. The last patches closed on 2026-09-29: durable preferences went into the
contract ticket (`preferences.md`), "do X when Y" watches were ruled out of scope, and
connection modes needed nothing, because every Pivot record lives on the server and only
per-device view state (layout, view choice, wallpaper) lives on the client.

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
- **Mobile Pivot view** ([ticket](issues/19-mobile-pivot-view.md), closed). Its own
  effort after the desktop spec lands. Until then mobile gets the Pivot as a chat,
  teammates as threads, and push for escalated decisions, with no new mobile UI.
- **"Do X when Y" watches** (firstmate's `state/when/`, `process-event-sources`). Wakes
  on teammate and delivery events cover the cases this map needs.
- **Upstream contribution tracking** (firstmate's `fm-contributions.sh`).
