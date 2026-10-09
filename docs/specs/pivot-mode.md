# Pivot mode

Spec synthesized on 2026-09-30 from the Pivot mode wayfinder map
(`.scratch/pivot-mode/map.md`, eighteen resolved tickets). firstmate
(`kunchenguid/firstmate`) is the reference design throughout. The triage of its behavior
lives in `docs/findings/firstmate-contract-triage.md`. Vocabulary is in `CONTEXT.md`: Pivot,
retired, teammate, ship, scout, teammate status, decision, escalated, Pivot view, Pivot
mode.

Rebased on 2026-10-05 onto upstream's Orchestration V2, after the fork merged
`v0.0.46-nightly.20261005.2676`. The rule for the rebase: where V2 ships a behavior, Pivot
mode uses it. The spec keeps its own behavior only where V2's would change what a Pivot
is: teammates nest under their Pivot, wake it after every run, and carry on after a
restart.

T3 Pivot keeps its own data folder, separate from the T3 Code (Nightly) app, and tracks the
same upstream build. Pivot mode adds nothing to the V2 database that T3 Code can't read;
its own records live in a separate database next to it.

## Problem statement

A user who runs several coding agents at once spends their attention juggling threads:
remembering what each one was for, checking which one finished, spotting the one stuck on
a question, and deciding what should happen next. T3 shows every thread in the sidebar, so
seeing them is easy. Keeping track is the user's job, and it grows with every thread they
open.

firstmate solves this in a terminal: one agent, the first mate, takes the user's intent,
dispatches workers into isolated checkouts, supervises them, and brings back only
outcomes and decisions. It does this through tmux panes, bash scripts and status files,
which T3 has no way to show, and which T3's clients cannot reach from another device.

## Solution

A **Pivot** is a thread whose agent supervises teammates. The user talks to the Pivot and
nobody else. The Pivot dispatches **teammates**, each a thread in its own worktree,
supervises them, answers what it can, escalates to the user only the decisions that need
the user's authority, and lands finished work on the user's word.

V2 already does much of the work: it launches threads into fresh worktrees, queues and
steers messages on the server, reads transcripts, and posts notification messages that
wake an agent. Pivot mode adds the team on top: who belongs to which Pivot, what each
teammate reports, when the Pivot wakes, the decisions it escalates, the delivery gate,
teardown and recovery. The Pivot's instructions carry the judgment, copied from
firstmate's contract. Pivot mode's records live on the server in their own event-sourced
database, so every client and every connection mode sees the same state, and a restart
loses nothing. In T3 Code, a Pivot reads as an ordinary chat and its teammates as ordinary
threads.

A project has at most one active Pivot. Starting a new one hands the old Pivot's live
teammates to it, and the old one is **retired**. The user sees a Pivot either as an
ordinary chat with its teammates nested under it in the sidebar, or in the **Pivot
view**: a full-screen layout the user composes from panes (the Pivot chat, teammate
cards, one teammate's chat, a preview, files, a diff), with an optional wallpaper.

## User stories

### Creating and replacing a Pivot

1. As a user, I want to create a Pivot from the sidebar's New menu, the command palette,
   or a keybinding, so that I can start supervised work from wherever I am.
2. As a user, I want to pick the Pivot's provider (Claude Code, Codex or Cursor) and model
   when I create it, so that the supervisor runs on the agent I trust.
3. As a user, I want "New Pivot" disabled with a reason in a project that is not a git
   repository, so that I understand why teammates cannot run there.
4. As a user, I want creating a Pivot while one is active to show me what it will take
   over, so that I never lose track of running work by accident.
5. As a user, I want a new Pivot to take over every live teammate, open decision and
   pending wake from the active one, so that I can start a clean conversation without
   stopping work.
6. As a user, I want the old Pivot to stay as read-only history with its finished
   teammates under it, so that I can look back at what happened.
7. As a user, I want the new Pivot to be able to read the retired Pivot's conversation,
   so that plans I only mentioned in the old chat are not lost.
8. As a user, I want "New Pivot conversation" in the Pivot view's menu to do the same
   takeover, so that the action is where I notice my context is full.
9. As a user, I want the Pivot to keep working through automatic compaction, so that a
   long session does not force a takeover.
10. As a user, I want a Pivot to stay a Pivot for good, so that there is no state where
    teammates lose their supervisor.

### Talking to the Pivot and dispatching

11. As a user, I want to describe work to the Pivot in plain words and have it dispatch
    teammates, so that I state intent once instead of opening threads myself.
12. As a user, I want each teammate to start in its own worktree on its own branch, so
    that teammates never step on each other or on my checkout.
13. As a user, I want the teammate's brief to carry my words verbatim, separate from the
    Pivot's instructions, so that reviewers and the teammate see what I actually asked.
14. As a user, I want teammates to use my project's default model unless I name one, so
    that dispatch does not surprise me with cost.
15. As a user, I want the Pivot to choose effort sensibly (low for clear work, higher for
    ambiguous design, never maximum unless I ask), so that I do not pay for effort the
    task does not need.
16. As a user, I want teammates to work without stopping for permission prompts, so that
    supervised work does not stall on me.
17. As a user, I want to see a teammate's setup progress on its card, so that a slow
    fetch or setup script is not a mystery.
18. As a user, I want a teammate whose setup failed to be retried or torn down by the
    Pivot, so that I never find orphaned worktrees.
19. As a user, I want the Pivot to dispatch a scout when the right answer is unclear, so
    that investigation comes back as a report instead of a half-built change.
20. As a user, I want a scout that finds shippable work to be promoted in place, so that
    its context is not thrown away.
21. As a user, I want the Pivot to dispatch independent work in parallel, so that the
    whole job finishes sooner.
22. As a user, I want the Pivot never to edit my project itself, so that every change
    comes from a teammate with a branch and a review path.
23. As a user, I want teammates to keep every T3 tool any thread has, including starting
    helper threads of their own, so that a teammate works like any other thread.

### Supervision

24. As a user, I want each teammate's status to reflect what it is actually doing, so
    that a stale report never tells me something finished when it did not.
25. As a user, I want to see when a teammate stopped without saying why, so that silent
    failures surface.
26. As a user, I want the Pivot to notice a teammate that has gone quiet for half an
    hour, so that stuck work gets looked at.
27. As a user, I want the Pivot to be told when teammates finish, fail, block or need a
    call, so that it acts without me watching.
28. As a user, I want changes that arrive while an update is still waiting to reach the
    Pivot as one update, so that it does not spend a turn per teammate.
29. As a user, I want the Pivot's updates to appear in its chat as collapsed notices I
    can expand, so that nothing is hidden and nothing floods the chat.
30. As a user, I want an update to reach the Pivot while it works, steered into its
    current turn where its provider allows, so that it acts on news without waiting.
31. As a user, I want a teammate waiting on an external thing to be rechecked when the
    wait should clear, so that it is not forgotten or nagged about.
32. As a user, I want a teammate stopped by a usage limit to read as paused until the
    limit resets, so that a limit is not mistaken for a failure.
33. As a user, I want the Pivot to be able to send a teammate a follow-up that waits for
    its turn to end, so that instructions arrive at a clean point.
34. As a user, I want the Pivot to be able to steer a running teammate at once for an
    urgent correction, so that a wrong turn does not run to completion.
35. As a user, I want the Pivot to be able to interrupt or stop a teammate, so that
    runaway work can be halted.
36. As a user, I want a new ask I give the Pivot about a running teammate to be added to
    that teammate's intent in my words, so that the record of what I asked stays true.

### Decisions

37. As a user, I want the Pivot to answer teammates' questions that follow from what I
    already asked, so that I am not a relay for obvious calls.
38. As a user, I want the Pivot to bring me only calls that widen the task, pick a
    product direction, or do something destructive, irreversible or security-sensitive,
    so that my attention goes where only I can decide.
39. As a user, I want each escalation to show evidence, consequence, options and a
    recommendation, so that I can decide quickly.
40. As a user, I want several questions from one gate to arrive as one decision, so that
    I answer them together.
41. As a user, I want open decisions to stay visible above the Pivot's composer until I
    answer, so that they do not scroll away.
42. As a user, I want my answer recorded in my exact words, so that there is an honest
    record of what I ruled.
43. As a user, I want my answer to go through the Pivot to the teammate, so that the
    Pivot can turn it into instructions the teammate can act on.
44. As a user, I want to be able to audit the answers the Pivot gave on its own, so that
    I can check its judgment.
45. As a user, I want a decision to stay open until someone answers it, even if the
    teammate finishes or is torn down, so that no question is silently dropped.
46. As a user, I want the Pivot to be able to close a question that became moot, marked
    as not my words, so that stale questions do not pile up.

### Delivery and landing

47. As a user, I want a teammate's work to count as done only when its PR exists and its
    head is pushed, so that "done" means reviewable.
48. As a user, I want the Pivot to tell me when a PR is ready, with its full URL, so that
    I can review it.
49. As a user, I want nothing merged without my explicit approval, so that I stay the
    merge authority.
50. As a user, I want the merge to check that the PR is open, not a draft, mergeable and
    green at its current head, so that nothing unverified lands.
51. As a user, I want the merge pinned to the head that was checked, so that a push after
    the check makes the merge fail.
52. As a user, I want red checks never merged unless I waive a specific check, so that
    CI failures are not waved through.
53. As a user of a project with no remote, I want teammates to deliver ready branches
    that land by fast-forward, so that Pivot mode works offline.
54. As a user, I want the Pivot to hear when a PR is merged or closed outside it, or when
    checks go red after "done", so that it reacts to the real world.
55. As a user on Azure DevOps, Bitbucket or Forgejo, I want the delivery gate to work and
    to merge by hand, so that I am not blocked while the Pivot's merge covers GitHub and
    GitLab.
56. As a user, I want scout reports stored with the teammate and kept after cleanup, so
    that findings survive.
57. As a user, I want the Pivot to clean up teammates whose work has landed, without
    asking me, so that finished worktrees and dev servers do not accumulate.
58. As a user, I want cleanup to refuse when work has not landed, so that nothing is
    thrown away without my word.
59. As a user, I want a cleaned-up teammate's history to stay readable, so that I can
    look back at how it got there.

### Restart and recovery

60. As a user, I want a server restart to lose no teammate, decision or pending update,
    so that I can restart without fear.
61. As a user, I want the Pivot and its teammates to carry on by themselves after a
    restart, interrupted runs resumed and queued messages delivered, so that work
    continues without me.
62. As a user, I want the Pivot's first turn after a restart to tell me which teammates
    resumed and which did not, so that I know where things stand.
63. As a user, I want the Pivot to be able to relaunch a dead or wedged teammate in
    place, so that its worktree and history are kept.

### Seeing it all

64. As a user, I want a Pivot in the sidebar with a badge, expandable to its teammates,
    so that I can reach any teammate from the default view.
65. As a user, I want a switch in the header between Chat and Pivot view, and a
    keybinding for it, so that I can move between the two ways of seeing a Pivot.
66. As a user, I want each Pivot to remember whether I last used Chat or Pivot view on
    this device, so that it opens how I left it.
67. As a user, I want the Pivot view to hide the sidebar, so that the screen goes to the
    work.
68. As a user, I want to compose the Pivot view from panes and start from presets, so
    that the screen fits how I work.
69. As a user, I want to hide any pane, bring it back, resize panes and move a pane to
    any edge, so that I can rearrange without starting over.
70. As a user, I want each Pivot to remember its layout on this device, so that I set it
    up once.
71. As a user, I want a card per teammate showing status, title, PR or scout, and
    provider, so that I read the whole team at a glance.
72. As a user, I want attention statuses to stand out on a card, so that what needs
    action is obvious.
73. As a user, I want cards to keep their order, so that nothing jumps under my cursor.
74. As a user, I want finished teammates folded into one "N finished" chip, so that live
    work stays in front.
75. As a user, I want a card's menu to open that teammate's chat, diff, files or preview
    in a pane, so that I inspect exactly what I pick.
76. As a user, I want a teammate's chat in the Pivot view to be read-only apart from
    approvals, so that steering stays with the Pivot.
77. As a user, I want to be able to type into a teammate from the sidebar, and have the
    Pivot told what I said, so that I can intervene directly without the Pivot's record
    going stale.
78. As a user, I want to set a wallpaper behind the Pivot view, with a dim level, so that
    my screen looks the way I like.
79. As a user, I want the Pivot view to stay smooth with many teammates and a wallpaper,
    so that it never costs me frames.

### Notifications

80. As a user, I want to be notified by the Pivot only for decisions, ready PRs,
    finished findings and the Pivot's replies to me, so that notifications mean
    something.
81. As a user, I want teammate threads to notify me and push only when their agent asks
    me a question or for an approval, so that ten teammates do not mean ten pings but a
    question only I can answer still reaches me.
82. As a user on my phone, I want an escalated decision to reach me as a push, so that I
    can unblock work while away.

### Customizing the Pivot

83. As a user, I want to keep my own standing rules for the Pivot in a file T3 never
    overwrites, so that my preferences survive updates.
84. As a user, I want the Pivot to write a standing preference down when I state one, so
    that I do not repeat myself after a restart or a compaction.
85. As a user, I want the Pivot to talk plainly, so that its messages read like a
    colleague's.

## Implementation decisions

### The model

- **Pivot mode keeps its own database.** `pivot.sqlite` sits in the T3 home's userdata
  folder next to V2's `statev2.sqlite`, with its own migrations and its own event log, and
  projections derived from it. T3 Code never opens it. Its records are keyed by V2 thread
  id: Pivots, teammates, decisions and each Pivot's wake cursor.
- **Nothing Pivot-specific goes into V2's database,** because T3 Code opens the same file:
  - no new V2 event types, since V2 decodes stored events strictly and T3 Code would fail
    on one it doesn't know;
  - no fields on V2 threads, since T3 Code drops fields it doesn't know when it rewrites a
    thread;
  - no migrations, since a fork migration would take an id upstream later uses for its own.

  What Pivot mode puts in V2 is what V2 already models: threads, messages sent with the
  Pivot as sender, and notification messages whose `teammate` source older builds decode
  as `background_task`.

- **Records.** A Pivot holds its thread, project, and whether it is retired and which
  Pivot took over. A teammate holds its thread, its owning Pivot, its kind (ship or scout),
  its brief, its latest report with the run it was made in, its resume state after a
  restart, and when it was dispatched.
- **Teammates are not V2 subagents.** A teammate is a top-level V2 thread that its Pivot
  mode record ties to a Pivot. It has no `subagent` lineage, so V2's rules for delegated
  tasks never apply to it: one result and then no more wakes, hidden from the sidebar,
  silenced as a child. Threads started any other way, including by a teammate through V2's
  tools, keep V2's rules.
- **Creating across two databases.** The Pivot service launches the thread through V2's
  thread launch, then records it, under a lock per project. If recording fails, it archives
  the new thread, so no Pivot or teammate thread exists without its record.
- **No new aggregate.** A teammate is 1:1 with its V2 thread and its worktree. A relaunch
  is a new run on the same thread with a new provider session. This mirrors firstmate's
  task (the durable unit) and endpoint (the replaceable agent session).
- **One active Pivot per project.** The Pivot service refuses to create a second Pivot in
  a project whose active Pivot is not retired, unless the command is a takeover.
- **Takeover.** Creating a Pivot while one is active moves every live teammate, open
  decision and pending wake from the active Pivot to the new one in one Pivot-store
  transaction, and marks the old one retired. A retired Pivot is read-only history: its
  composer is hidden, and its unsettled finished teammates stay nested under it.
- **Permanence.** No release, no adoption. A thread is a Pivot or a teammate from
  creation and stays one. Teammates only come from dispatch.
- **Worktrees are required.** The server refuses a dispatch that does not produce a
  worktree, so a teammate can never commit in the primary checkout. Pivot mode needs a
  git repository, so it is unavailable for threads without a project.
- **Dispatch belongs to the Pivot. V2's tools belong to every thread.** Only a Pivot
  creates teammates, and only in its own project, because a teammate is defined by its
  Pivot. Every thread, the Pivot and its teammates included, keeps V2's thread tools
  (`delegate_task`, `t3_thread_launch`, `t3_thread_send` and the rest) with V2's own
  scoping.
- **Clients get a Pivot stream.** V2's thread shell gains nothing. Clients subscribe to a
  Pivot-state stream (Pivots, teammates with their report and resume state, escalated
  decision counts) and join it to V2's thread shells by thread id. The brief (intent, spec,
  definition of done) rides teammate detail only, never the stream, because the stream
  goes to every client.

### Teammate status

- **Reported status.** A teammate reports one of `working` (with a phase line),
  `needs-decision`, `blocked`, `paused` (an external wait, optional `until`), `done` or
  `failed`. Each report is an event scoped to the run it was made in.
- **Runtime state** comes from V2's thread shell: `pendingRuntimeRequest`, `status` (the
  latest run's status, or idle), `pendingBackgroundTasks`, `lastError` and
  `usageLimitResetAt`.
- **One pure function** in shared code combines them. The server uses it for the Pivot's
  reads and for wakes. Web and mobile use it for display. Its output is one of eight
  teammate statuses: `working`, `waiting`, `needs-decision`, `blocked`, `paused`, `done`,
  `failed`, `unreported`.
- **Precedence**, in order:
  1. A pending runtime request (an approval or a question) is `waiting`.
  2. A run that is preparing, queued, starting or running, or pending background work,
     is `working`, whatever was reported before.
  3. A run stopped by a usage limit is `paused` until `usageLimitResetAt`. V2's limit
     recovery resumes it.
  4. When idle, the terminal report from the latest run counts.
  5. When idle with no terminal report in the latest run: `failed` if the run failed,
     otherwise `unreported`. A run interrupted by a server restart reads `working` while
     the server resumes it, and `failed` only if the resume fails.
  6. A terminal report stands over a failure later in the same run. The error shows in
     the detail.
- Because reports are scoped to their run, a steered follow-up that ends silently reads
  `unreported`, never a stale `done`.

### Dispatch and the brief

- **Dispatch uses V2's thread launch** with the worktree strategy: a fresh base from
  origin, the project's setup scripts, the brief as the first message. V2 already moved
  the worktree bootstrap out of the WebSocket handler, so dispatch adds no service of its
  own.
- **Dispatch inputs:** title, kind, intent (the user's words), spec (the Pivot's
  instructions), optional base branch, optional model selection.
- **The server renders the brief** from a fixed template, copying firstmate's launch
  brief: the teammate role first, so project instructions cannot reassign it; the user's
  intent; the Pivot's spec; the rules (report status through the tool, stay in the
  worktree, full PR URLs, the same obstacle twice means `blocked`, decisions go up); the
  definition of done. The kind and the delivery mode produce the definition of done, never
  the Pivot. The server refuses an empty intent or spec and an intent that opens with a
  speaker label.
- **The brief is the teammate's first message,** sent with the Pivot as its sender
  thread. That is V2's marker for a message from another thread, and every message the
  Pivot sends a teammate through V2's tools carries it too. Messages with the Pivot as
  sender render as the Pivot's, the brief collapsed. The brief is write-once: promotion
  and new asks append, never overwrite.
- **Model and effort.** The project's default model selection unless the user named one;
  the Pivot's own when the project has none. Effort by firstmate's fallback: low for clear
  work, extra-high for ambiguous design, never max unless asked. No quota profiles.
- **Runtime mode is always full-access,** whatever the project default, because
  firstmate's workers never wait on a human. The `waiting` wake is the safety net. V2
  caps a launched thread's modes at the caller's, and the Pivot runs full-access.
- **Branch.** The server derives `pivot/<slug of the title>`, adds a suffix if taken, and
  passes it as the launch's branch. V2 only renames temporary branches, so the branch
  never changes after dispatch. Scouts get one too.
- **Base.** The origin's default branch, fetched fresh. The Pivot may pass a base branch
  to stack on another branch.
- **Result.** Dispatch returns once the thread and worktree exist and the first run has
  started. A failing setup script still starts the teammate and the result says so. A
  failed launch follows V2: a cancelled one leaves nothing behind, and a failed one keeps
  the worktree its thread recorded so that a retry reuses it. The teammate reads
  `failed`. The Pivot retries it with relaunch or tears it down; a worktree with no new
  commits passes the landed test.
- **Promotion.** Promoting a scout flips its kind and sends the superseding contract as a
  Pivot message: the ship rules, a new spec, the original intent kept.

### Steering and control

- **V2's tools carry messages and control.** The Pivot sends with `t3_thread_send` (queue,
  steer, auto or restart), edits, reorders and cancels queued messages with the
  `t3_queue_*` tools, interrupts with `t3_thread_interrupt`, and waits with
  `t3_thread_wait`. V2's server-side queue delivers a queued message when the teammate's
  run ends. Pivot mode adds no copies of these tools.
- **New asks join the intent.** A Pivot tool records the user's words verbatim on the
  teammate's intent and sends them, with the Pivot's own text, through the same send.
- **Answers close decisions.** A Pivot tool sends the answer through the same send and
  closes the decision. It refuses a decision that is not open.
- **Stop and relaunch** are Pivot tools, addressed to an exact teammate. Stop ends the
  provider session. Relaunch stops it and resumes the conversation through the provider's
  resume cursor, as V2's "Restart agent session" does, and reports a failure. Teardown and
  discard are never messages.
- **Exact target or refuse.** Every Pivot tool refuses an empty message and any target
  that is not a live teammate of the calling Pivot. V2's tools keep their own scoping.
- **Direct typing.** In the default view, the user can type into a teammate thread from
  the sidebar. The message is recorded as the user's and wakes the Pivot with the text
  verbatim. The Pivot view keeps teammate chat read-only apart from approvals, and an
  approval the user answers there is reported to the Pivot.

### What the Pivot reads

- **List teammates** is a Pivot tool: one line each (title, kind, status, latest report
  summary, branch, PR, last change, worktree path), copying firstmate's crew-state line.
  V2's `t3_thread_list` has no teammate status, so it does not cover this.
- **Read a teammate** with V2's `t3_thread_read`: bounded, incremental, and newest-first
  paging. The same tool reads the Pivot's retired predecessor.
- **Teammate history** is a Pivot tool: its status reports and decision events, bounded.
- **Files and diffs:** the Pivot reads the teammate's worktree with its own tools, as
  firstmate's first mate reads projects directly.
- **Scope:** Pivot tools see only the calling Pivot's teammates. V2's reads keep their
  environment-wide scope.

### Waking the Pivot

- **The Pivot supervisor** is a server worker following V2's `PullRequestWatchReactor`
  and `UsageLimitRecoveryWorker`. It subscribes to orchestration events and owns
  everything that happens without a caller: wakes, rechecks, the stuck bound, the
  post-restart digest. Queued-message delivery is V2's.
- **Wake set:** a teammate reaching `done`, `needs-decision`, `blocked`, `failed`,
  `unreported` or `waiting`; a `paused` teammate's `until` passing, or four hours passing
  with no `until`; a running teammate with no activity for 30 minutes, once per run,
  never with an automatic interrupt; the user answering an escalated decision; the user
  typing directly into a teammate; delivery events from V2's PR sync (a PR merged or
  closed outside the Pivot, checks going red after `done`). `working` never wakes. No
  periodic heartbeat.
- **Delivery.** A wake is a V2 notification message on the Pivot thread, the way a PR
  watch wakes its thread, with a new `teammate` notification source. Older clients decode
  an unknown source as `background_task`. It is routed like a delegated task's result:
  steered into the Pivot's running turn when its provider steers without interrupting
  tools, otherwise queued behind it. Changes that land while a wake is still queued join
  that wake. There is no batching timer. The user's own messages follow their normal
  queue or steer setting.
- **Content.** Each teammate that changed since the last wake (title, status, summary),
  then every open decision. The chat renders it collapsed, as V2 renders its other
  notification messages. When the wake is for a stuck or `unreported` teammate, the
  supervisor attaches firstmate's stuck-teammate ladder. For a `failed` one, it attaches
  the diagnostic-reasoning guidance.
- **Acknowledgement.** The supervisor records each teammate change it sees in V2's events
  (a status transition, a PR merged or closed) as an event in Pivot mode's own log. Each
  Pivot has a wake cursor, the Pivot-log sequence its last wake covered. Pending items are
  the events after it. The cursor advances when a wake goes
  out. The wake is a durable message in the Pivot's conversation, so an interrupted wake
  turn still has it in context. Changes the Pivot causes itself never wake it. Pending
  wakes are derived from events, and the recheck and stuck timers are rebuilt from state
  after a restart.
- **The Pivot never settles.** It is created with auto-settle off, because V2 refuses
  server wakes into a settled thread.

### Decisions

- **One record per decision,** owned by a Pivot and moved with a takeover. It optionally
  links to a teammate and carries a key (`default` when none is given). A teammate's
  `needs-decision` or `blocked` report opens one. The Pivot can open one for its own
  questions. It is not a provider runtime request (the kind `t3_pending_request_respond`
  answers), because those block the asking run.
- **Two stages.** A decision starts with the Pivot, which answers anything unambiguous
  toward the user's intent and escalates only contract expansion, unsettled product or
  architecture calls, and destructive, irreversible or security-sensitive choices. An
  escalated decision is held for the user. Answers the Pivot gives itself are recorded and
  labeled as the Pivot's.
- **Escalation fields:** one or more questions, evidence, consequence, options,
  recommendation. Several questions from one gate form one decision.
- **The user's answer** is recorded verbatim (up to 8 KB), wakes the Pivot, and the Pivot
  relays it to the teammate, which closes the decision.
- **Closing.** Only three things close a decision: an answer the Pivot sends; the
  teammate itself, for a blocker that cleared with no answer and was never escalated; the
  Pivot marking it moot with evidence, labeled as not the user's words. A `working`,
  `done` or `failed` report never closes one, and neither does teardown.
- **No "later".** An unanswered decision stays open, and every wake lists it.
- **Events,** in Pivot mode's log: opened, escalated, answered, closed, marked moot.

### Delivery and merge

- **Modes:** direct-PR for a project with a remote, local-only without one. The mode
  produces the definition of done in the brief.
- **Ready.** In PR mode, `report_status` refuses a ship's `done` without a linked PR
  whose head is pushed. Teammates link PRs with V2's `link_pull_request`, and may watch
  them with `watch_pull_request` like any thread. Local-only: `done` names the ready
  branch.
- **Merge** requires the user's recorded approval of a "PR ready" decision. It reads
  live state and refuses a closed, draft or unmergeable PR, and any check not green at the
  current head, where a required check that never reported counts as not green. It
  reports every failing condition. It passes the verified head to the forge, so a push
  after the check fails the merge. Default method: squash. The only way past a red check
  is an explicit user waiver naming that check.
- **Forges.** The Pivot merges on GitHub and GitLab, the forges firstmate supports. T3's
  existing merge gains head pinning on both. On Azure DevOps, Bitbucket and Forgejo, the
  delivery gate and delivery wakes still work through V2's PR sync, and the user merges by
  hand.
- **Local landing** is a fast-forward only. A diverged branch refuses and the teammate
  rebases.
- **After a merge** the Pivot posts one line with the full URL. V2 settles the teammate
  once its PR merges, and the Pivot tears it down.
- **Scout reports** are stored as a record on the teammate, readable by the Pivot and in
  the teammate pane, and kept after teardown.

### Teardown

- **Landed test,** copying firstmate: the work is reachable from a remote-tracking ref,
  or its PR merged with a head containing the local work, or its content is already in
  the up-to-date default branch. Local-only also accepts a merge into the local default
  branch. Uncommitted work never counts. Anything inconclusive refuses.
- **The Pivot tears down landed work itself.** Discarding unlanded work needs the user's
  explicit word, recorded as a decision answer. A refusal is reported as a finding.
- **A scout's worktree** goes once its report record exists.
- **Order:** stop the session (refuse before touching any record if that fails), stop
  the worktree's managed processes, remove the worktree through T3's existing clean-tree
  check, release the port block, archive the thread. The branch ref stays. Open
  decisions stay open.
- **The way back:** unarchiving a torn-down teammate shows its history. More work means a
  fresh dispatch stacked on the kept branch.

### After a restart

- **Pivot threads carry on.** V2's startup recovery finds runs the restart interrupted
  and holds queued runs until the user resumes them. For Pivot and teammate threads the
  server resumes interrupted runs whatever the project's continue-after-update setting
  says, and releases their held queues. Other threads keep V2's behavior.
- **Relaunch** resumes the conversation through the provider's resume cursor, as a
  transaction: stop the old session, start the new one, report if that fails.
- **The first wake after a restart is a digest:** which teammates resumed, which failed
  to, and every open decision. A takeover's first turn is the same digest.

### Where the Pivot runs

- **The Pivot home** is a small git repository per project under T3's userdata, shared
  by the project's active Pivot and every retired one. Its files: `AGENTS.md` (the
  contract, owned by T3 and rewritten on update), `CLAUDE.md` pointing at it, and
  `preferences.md` (the user's own rules, never overwritten).
- **The home is the Pivot's working directory.** The Pivot launches with V2's
  existing-worktree strategy pointed at the home. The project's own instructions never
  load into the Pivot, relative paths cannot touch the project, checkpoints keep working,
  and Claude Code, Codex and Cursor all find their instructions without adapter changes.
  Storage cleanup skips the home. T3 Code's own cleanup cannot remove it either, because
  it is not a worktree of the project's repository.
- **"Never write to a project"** is held by the contract, as in firstmate. The Pivot runs
  full-access so it can read teammate worktrees and use `gh`. Where a harness sandboxes
  writes to its working directory, that enforcement comes for free.
- **Capabilities.** V2 grants every thread `orchestration`, `worktree` and
  `pull-requests`. The Pivot also gets a `pivot` capability with the tools its contract
  names: `dispatch_teammate`, `promote_scout`, `add_intent`, `open_decision`,
  `escalate_decision`, `answer_decision`, `mark_decision_moot`, `list_teammates`,
  `teammate_history`, `stop_teammate`, `relaunch_teammate`, `merge_teammate`,
  `land_teammate` (the local fast-forward) and `teardown_teammate`. It gets no browser or
  device tools; teammates verify. Teammates also get a `teammate` capability
  (`report_status` and `record_scout_report`) on top of what V2 and the project grant.

### The Pivot's contract

- **Content** copies firstmate's judgment text, trimmed of script names, yolo and
  no-mistakes: the hard rules; identity (the Pivot never does project work itself);
  intake (ship by default, scout for reports or real uncertainty, relay existing evidence,
  dispatch isolated work in parallel); delivery and merge judgment; mid-task changes;
  escalation etiquette (outcomes, a standalone final message, the user's nouns, no
  verbatim status lines, the escalate-now list, full PR URLs); brief writing; the rule
  that a current explicit instruction beats standing rules only within its exact scope;
  knowledge routing (project knowledge goes into the project's `AGENTS.md` through a
  teammate); the `ask-user-authority` decision rule; firstmate's translation list,
  rewritten into this repo's vocabulary and V2's tool names; after a compaction or
  takeover, re-read state before acting; read `preferences.md` at start and after a
  compaction; write to it only when the user states a standing preference.
- **No "captain" and no nautical flavor.** A true no-op is one plain line such as
  "Nothing needs you."
- **Ceiling: 3,000 words** always loaded. Situational guidance rides the wake that
  triggers it instead of sitting in the contract.

### Notifications

- In Pivot mode the user hears from the Pivot about: an escalated decision (which covers
  PR ready, destructive or irreversible asks, credential needs, and blockers the Pivot
  cannot clear), finished scout findings, and the Pivot's reply when the user was
  talking to it.
- Teammate threads fire desktop notifications, sound and mobile push only for a pending
  question or approval, which only the user can answer, in the teammate's chat. Their
  other events go to the Pivot. V2 already skips `subagent` threads in the web notifier
  and the relay. Teammates are not subagents, so those same checks gain a teammate test
  that lets a pending runtime request through.
- An escalated decision maps to the relay's existing waiting-for-input phase on the Pivot
  thread, so mobile push needs no new phase.

### The Pivot view and the sidebar

- **Sidebar.** A Pivot sits among the project's threads with a Pivot badge and a count
  of escalated decisions, and expands to its teammates. V2 hides `subagent` threads from
  the sidebar. Teammates are not subagents, so they stay visible, and the sidebar nests
  them under their Pivot using the Pivot stream. Nested rows show the same status colors
  as threads (blue working with its elapsed time, orange when someone must act, green
  paused or done). A teammate torn down, or whose thread settled (its PR merged or
  closed), leaves the nested list as settled threads leave the inbox.
- **Switch.** The header center shows a Chat / Pivot view switch on a Pivot. A keybinding
  toggles it. Each Pivot remembers its last choice per device. The Pivot view has no
  sidebar.
- **Layout tree.** The Pivot view is a tree of row and column splits holding panes. The
  user hides or shows any pane (at least one stays), resizes with dividers, moves a pane
  to an edge through its menu, and starts from presets. The tree is the only layout
  state, so drag-and-drop docking can come later without changing it. Each Pivot keeps
  its tree per device, client-side.

  The shape, from the prototype:

  ```ts
  type LayoutNode =
    | { type: "pane"; kind: PaneKind; teammate?: ThreadId }
    | { type: "row" | "col"; children: LayoutNode[]; sizes: number[] };
  ```

- **Presets:** teammates top with chat bottom; chat left with teammates right; three
  columns (chat, teammates, teammate); chat and teammates on top with preview below.
- **Panes:** Pivot chat, Teammates, Teammate, Preview, Files, Diff. Preview, Files and
  Diff reuse T3's existing right-panel components. A teammate-bound pane names its
  teammate in its header.
- **Opening a teammate** goes through the card's menu: View chat, View diff, View files,
  View preview. Each opens that pane for that teammate, or switches the pane to it if
  already open. Clicking the card is View chat. There is no hidden focus state.
- **The card:** status top left (dot, elapsed time, label), actions menu top right,
  title in the middle, PR number or "Scout" bottom left, provider icon bottom right. No
  project name. An escalated decision reads "needs you". Attention statuses (`waiting`,
  `blocked`, `failed`, `unreported`, an escalated decision) get an accent border. Cards
  keep dispatch order. Finished teammates fold into one "N finished" chip at the end,
  which toggles their cards. Cards wrap and the pane scrolls.
- **Motion.** The elapsed time updates at most once a minute. Nothing on a card animates.
- **The Teammate pane** shows the teammate's chat read-only: the brief collapsed, Pivot
  messages marked, pending approvals answerable. The Preview pane shows the teammate's
  managed processes and preview with their existing start, stop and pin controls.
- **The Pivot chat pane** shows wake notices collapsed and holds escalated decisions in
  a strip above the composer, answered with T3's existing question UI (options plus free
  text).
- **Wallpaper.** A Pivot view setting per device, stored on the client and never sent
  over the WebSocket, with a dim level. One static layer behind the panes, downscaled to
  the screen once when picked. No blur filter over it. Panes are solid or plain alpha,
  and the Teammates pane is see-through.

## Testing decisions

A good test states behavior a user, the Pivot or a teammate would notice, and asserts on
what a caller gets back and what the world looks like afterwards. No assertions on call
counts, internal ordering or which private helper ran. Timing tests drive a test clock.
Async flows wait on receipts and worker drains, never on sleeps. Nothing renders
components to static markup. Tests sit next to their module, the house convention.

Seams, in order of how much they prove:

- **The Pivot store** (new). Run commands against a real temporary `pivot.sqlite` and
  assert on its projections. Covers Pivot and teammate records, one active Pivot per
  project, takeover and retirement, only-a-Pivot-dispatches, the worktree requirement,
  status report events, the decision lifecycle, intent appends, and the archive when
  recording a launched thread fails. V2's database gains no Pivot event types or thread
  fields.
- **Teammate status** (new, pure, shared). Every precedence rule as a table of report
  plus V2 shell inputs to one of eight statuses.
- **The Pivot and teammate toolkits** (existing MCP toolkit pattern). Every Pivot and
  teammate tool and every refusal: dispatch (brief rendering, the speaker-label refusal,
  branch naming, a failed launch reading `failed`), promote, new asks, decisions, stop,
  relaunch, list teammates and teammate history with their bounds, merge (approval
  required, live checks, head pinning), teardown (the landed test against a real
  temporary repository, the refusal), `report_status` (the `done` refusal) and the scout
  report. Capability gating: a teammate cannot call Pivot tools and the reverse. V2's own
  tools are not retested.
- **The Pivot supervisor** (new, a worker like `PullRequestWatchReactor`). The wake set,
  steering into a running Pivot turn and queuing otherwise, joining a queued wake, the
  cursor, `paused` rechecks, the stuck bound, attached guidance, and the post-restart
  digest. Test clock throughout.
- **The Pivot home** (new). Creation writes the repository and its files, the Pivot
  launches in it, an update rewrites `AGENTS.md` and leaves `preferences.md` untouched,
  and the contract stays under 3,000 words.
- **Existing seams, extended.** V2's restart recovery resumes Pivot and teammate runs and
  releases their held queues whatever the setting says. The GitHub and GitLab merge paths
  pin the head. The relay publishes a teammate thread's activity only while a question
  or approval holds it. Storage cleanup skips Pivot homes.
- **Pivot view logic** (new, pure, client). Layout tree operations (presets, hide, show,
  move to an edge, resize, at least one pane) and the card view model (label, attention,
  dispatch order, the finished chip).
- **Sidebar logic** (existing). A Pivot groups its teammates, a retired Pivot keeps its
  finished ones, and teammate threads notify only for a question or approval.

The UI wiring (the Pivot view, the sidebar rows, the header switch, the card menus, the
wallpaper setting) is the last step, verified in one integrated pass in a real client.

## Tasks

Tasks marked **Done** landed on `main` before implementation started. Skip them.

1. Create `pivot.sqlite` with its own migrations, event log and projections, and stream
   Pivot state to clients, joined to V2 thread shells by thread id. Seam: Pivot store.
2. Create a Pivot through the thread launch in its Pivot home, with auto-settle off, and
   read it back from the Pivot stream. Archive the thread if recording it fails. Seam:
   Pivot store.
3. Refuse a second Pivot while one is active. Seam: same.
4. Refuse a Pivot in a project that is not a git repository. Seam: same.
5. Record a teammate at launch with its owning Pivot and kind, and show
   `teammate: { pivotThreadId, kind, status }` in the Pivot stream. Seam: same.
6. Refuse a teammate that is not dispatched by the active Pivot of its project. Seam:
   same.
7. Take over: a new Pivot receives every live teammate of the active one, and the old one
   reads retired. Seam: same.
8. **Done.** Combine report and V2 runtime state into the eight teammate statuses, covering every
   precedence rule and the run scoping. Seam: teammate status.
9. **Done.** Read a run interrupted by a restart as `working` while it resumes, and a run stopped
   by a usage limit as `paused` until the reset. Seam: same.
10. **Done.** Create the Pivot home with `AGENTS.md`, `CLAUDE.md` and an empty
    `preferences.md`. Seam: Pivot home.
11. **Done.** Rewrite `AGENTS.md` on update without touching `preferences.md`, and keep the
    contract under 3,000 words. Seam: same.
12. Grant the `pivot` capability only to the active Pivot and the `teammate` capability
    only to teammates. Seam: Pivot and teammate toolkits.
13. Dispatch a ship through the thread launch: the brief as the first message with the
    Pivot as sender, on a `pivot/<slug>` branch in a fresh worktree, full-access, and
    return once the first run starts. Seam: same.
14. Read a teammate whose launch failed as `failed` with its recorded worktree kept, and
    retry it with relaunch. Seam: same.
15. Refuse a dispatch with an empty intent or spec, or an intent that opens with a
    speaker label. Seam: same.
16. Dispatch a scout, and promote it in place with a superseding contract. Seam: same.
17. Report a status from a teammate and see it in the Pivot stream. Seam: same.
18. Refuse a ship's `done` in PR mode without a linked, pushed PR. Seam: same.
19. Store a scout report on the teammate. Seam: same.
20. List teammates and read status history, scoped to the calling Pivot. Seam: same.
21. Record the user's new words on a teammate's intent and send them through V2's send.
    Seam: same.
22. Stop and relaunch a teammate, report a failed relaunch, and refuse any target that
    is not a live teammate of the caller. Seam: same.
23. Open a decision from a teammate's `needs-decision` or `blocked` report, and from the
    Pivot directly. Seam: Pivot store.
24. Escalate a decision with its fields, record the user's verbatim answer, and close it
    when the Pivot sends the answer. Seam: Pivot and teammate toolkits.
25. Close a decision as moot with evidence, and let a teammate close its own
    non-escalated blocker. Never close one on a report or at teardown. Seam: Pivot store.
26. Move open decisions with a takeover. Seam: same.
27. Wake the Pivot on the wake set with a notification message, steered into its running
    turn where its provider allows and queued otherwise. Seam: Pivot supervisor.
28. Join changes into a wake that is still queued, and advance the wake cursor as each
    wake goes out. Seam: same.
29. Never wake the Pivot for changes it caused itself. Seam: same.
30. Recheck a `paused` teammate at its `until`, or after four hours. Seam: same.
31. Wake once per run for a running teammate with no activity for 30 minutes, and attach
    the stuck-teammate ladder. Seam: same.
32. Wake on the user's answer to an escalated decision and on the user typing into a
    teammate. Seam: same.
33. Wake on a PR merged or closed outside the Pivot and on checks going red after
    `done`. Seam: same.
34. Merge a teammate's PR on recorded approval after live checks, pinned to the verified
    head, on GitHub. Seam: Pivot and teammate toolkits, with the GitHub merge path.
35. The same on GitLab. Seam: same, with the GitLab merge path.
36. Refuse a merge without approval, on red, or on a closed, draft or unmergeable PR,
    naming every failing condition, and accept a waiver naming one check. Seam: Pivot and
    teammate toolkits.
37. Land a local-only teammate by fast-forward and refuse a diverged branch. Seam: same.
38. Tear down a landed teammate: stop the session, stop its managed processes, remove the
    worktree, release the port block, archive the thread, keep the branch. Seam: same.
39. Refuse teardown of unlanded work, including a squash-merged PR case that counts as
    landed. Seam: same.
40. Resume Pivot and teammate runs interrupted by a restart and release their held
    queues, whatever the continue-after-update setting says, and send the restart digest.
    Seam: V2 restart recovery and Pivot supervisor.
41. Publish no relay activity for teammate threads, and map an escalated decision to the
    Pivot's waiting-for-input phase. Seam: relay.
42. Skip Pivot homes in storage cleanup. Seam: storage cleanup.
43. Group teammates under their Pivot in the sidebar, keep a retired Pivot's finished
    teammates, and notify for teammate threads only on a question or approval. Seam:
    sidebar logic.
44. **Done.** Build and edit the layout tree: presets, hide, show, move to an edge, resize, and at
    least one pane. Seam: Pivot view logic.
45. Derive a card's label, attention, order and the finished chip from the Pivot stream
    and the thread shell. Seam:
    same.
46. **Done.** Write the Pivot contract from firstmate's judgment text under the ceiling. Seam:
    Pivot home.
47. Wire the UI: the New Pivot entry points with the takeover confirmation, the sidebar
    rows, the header switch and its keybinding, the Pivot view with its panes and card
    menus, the decisions strip, collapsed wake notices, the read-only Teammate pane with
    approvals, and the wallpaper setting. Verified in one integrated pass in a real client.

## Out of scope

- **Mobile Pivot view.** Its own effort after this spec lands. Until then mobile gets the
  Pivot as a chat, teammates as threads, and pushes for escalated decisions.
- **Drag-and-drop docking** of Pivot view panes. The layout tree is shaped for it.
- **Several active Pivots per project.** Adding it later means dropping one server rule
  and adding a second creation path.
- **Cross-project dispatch.**
- **Standing autonomy** (firstmate's `+yolo`, merging green work without asking).
- **no-mistakes validation.** The delivery gate uses CI on the linked PR.
- **A backlog of undispatched work.** The Pivot's chat and open decisions cover it.
- **Away modes** (`/afk`, `/quiet`, the digest daemon).
- **Remote hosts, Relay (X/Discord), voice, mail.**
- **Dispatch capping.** Parked in `docs/findings/dev-server-concurrency.md`. The Pivot
  never throttles on host capacity itself. Pivot mode makes the parked measurements
  takeable, because it produces real fleets.
- **"Do X when Y" watches.** Wakes on teammate and delivery events cover this spec. V2's
  scheduled tasks stay available to the Pivot for recurring work, as to any thread.
- **Merging from the Pivot on Azure DevOps, Bitbucket or Forgejo.**
- **A fresh-context relaunch.** Relaunch resumes; a looping teammate is torn down and
  re-dispatched on its branch.
- **Quota-aware model profiles.**
- **Upstream contribution tracking.**

## Further notes

- firstmate stops flowing in once this lands: its fixes get ported by hand. The Pivot's
  contract and the teammate brief copy its text as of `c5f48e4` (2026-09-29).
- Where this spec drifts from firstmate, the drift was put to the user and agreed:
  native instead of hosted; a steer delivery; direct typing from the sidebar; merging on
  GitHub and GitLab only; unarchiving a torn-down teammate; the server resuming teammates
  after a restart; relaunch resuming the conversation; no "captain"; `preferences.md` as
  the name of firstmate's `captain.md` split.
- The rebase onto V2 traded several of the spec's own mechanics for V2's, with the user's
  agreement: wakes steer into a running Pivot turn instead of waiting for it, with no
  batching timer; every thread keeps V2's thread tools, so nested helpers are possible;
  queueing, steering, transcript reads and the worktree bootstrap are V2's; a failed
  launch keeps its worktree for a retry; a usage-limited teammate reads `paused` and V2's
  limit recovery resumes it. The spec kept its own behavior in three places: teammates
  are not V2 subagents, so they nest in the sidebar and wake the Pivot after every run;
  and Pivot and teammate threads carry on after a restart whatever the setting says.
- Several decisions were corrected after being recorded, and the tickets carry the
  amendments: a Pivot started as a project pointer with a pointer-swap handover and a
  release event, and became a permanent thread kind with takeover and retirement;
  decisions moved from the project to the Pivot; teammates' runtime mode moved from the
  project default to always full-access; teammates moved from never notifying to
  notifying for a question or approval, the one thing only the user can answer.
- Performance: V2's thread shell gains nothing. The Pivot stream carries one small record
  per Pivot and teammate; the brief never rides it.
  The layout tree, view choice and wallpaper stay on the client. Cards do not animate.
- Separate data: T3 Pivot keeps `~/.t3-pivot`, apart from T3 Code's `~/.t3`, so both run
  at the same time. It tracks the same upstream build, and `pivot:sync` follows upstream's
  nightly tags, so a V2 database stays readable by either.
- Remote readiness: every Pivot record lives on the server, so local, remote and tunnel
  clients see the same state. Only per-device view preferences live on the client.
- Durable decisions and their reasons go into `docs/internals/` as the work lands, as the
  managed-processes effort did. The user guide gets a Pivot mode section.
