# Pivot mode

Spec synthesized on 2026-09-30 from the Pivot mode wayfinder map
(`.scratch/pivot-mode/map.md`, eighteen resolved tickets). firstmate
(`kunchenguid/firstmate`) is the reference design throughout. The triage of its behavior
lives in `docs/findings/firstmate-contract-triage.md`. Vocabulary is in `CONTEXT.md`: Pivot,
retired, teammate, ship, scout, teammate status, decision, escalated, Pivot view, Pivot
mode.

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

T3's server owns the exact mechanics, the way firstmate's scripts do: dispatch, status,
wakes, decisions, delivery gates, teardown, recovery. The Pivot's instructions carry the
judgment, copied from firstmate's contract. Everything lives in T3's event store, so
every client and every connection mode sees the same state, and a restart loses nothing.

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
18. As a user, I want a failed dispatch to leave nothing behind, so that I never find
    orphaned worktrees.
19. As a user, I want the Pivot to dispatch a scout when the right answer is unclear, so
    that investigation comes back as a report instead of a half-built change.
20. As a user, I want a scout that finds shippable work to be promoted in place, so that
    its context is not thrown away.
21. As a user, I want the Pivot to dispatch independent work in parallel, so that the
    whole job finishes sooner.
22. As a user, I want the Pivot never to edit my project itself, so that every change
    comes from a teammate with a branch and a review path.

### Supervision

23. As a user, I want each teammate's status to reflect what it is actually doing, so
    that a stale report never tells me something finished when it did not.
24. As a user, I want to see when a teammate stopped without saying why, so that silent
    failures surface.
25. As a user, I want the Pivot to notice a teammate that has gone quiet for half an
    hour, so that stuck work gets looked at.
26. As a user, I want the Pivot to be told when teammates finish, fail, block or need a
    call, so that it acts without me watching.
27. As a user, I want several changes arriving together to reach the Pivot as one
    update, so that it does not spend a turn per teammate.
28. As a user, I want the Pivot's updates to appear in its chat as collapsed notices I
    can expand, so that nothing is hidden and nothing floods the chat.
29. As a user, I want the Pivot never to be interrupted mid-reply by an update, so that
    my conversation with it stays coherent.
30. As a user, I want a teammate waiting on an external thing to be rechecked when the
    wait should clear, so that it is not forgotten or nagged about.
31. As a user, I want the Pivot to be able to send a teammate a follow-up that waits for
    its turn to end, so that instructions arrive at a clean point.
32. As a user, I want the Pivot to be able to steer a running teammate at once for an
    urgent correction, so that a wrong turn does not run to completion.
33. As a user, I want the Pivot to be able to interrupt or stop a teammate, so that
    runaway work can be halted.
34. As a user, I want a new ask I give the Pivot about a running teammate to be added to
    that teammate's intent in my words, so that the record of what I asked stays true.

### Decisions

35. As a user, I want the Pivot to answer teammates' questions that follow from what I
    already asked, so that I am not a relay for obvious calls.
36. As a user, I want the Pivot to bring me only calls that widen the task, pick a
    product direction, or do something destructive, irreversible or security-sensitive,
    so that my attention goes where only I can decide.
37. As a user, I want each escalation to show evidence, consequence, options and a
    recommendation, so that I can decide quickly.
38. As a user, I want several questions from one gate to arrive as one decision, so that
    I answer them together.
39. As a user, I want open decisions to stay visible above the Pivot's composer until I
    answer, so that they do not scroll away.
40. As a user, I want my answer recorded in my exact words, so that there is an honest
    record of what I ruled.
41. As a user, I want my answer to go through the Pivot to the teammate, so that the
    Pivot can turn it into instructions the teammate can act on.
42. As a user, I want to be able to audit the answers the Pivot gave on its own, so that
    I can check its judgment.
43. As a user, I want a decision to stay open until someone answers it, even if the
    teammate finishes or is torn down, so that no question is silently dropped.
44. As a user, I want the Pivot to be able to close a question that became moot, marked
    as not my words, so that stale questions do not pile up.

### Delivery and landing

45. As a user, I want a teammate's work to count as done only when its PR exists and its
    head is pushed, so that "done" means reviewable.
46. As a user, I want the Pivot to tell me when a PR is ready, with its full URL, so that
    I can review it.
47. As a user, I want nothing merged without my explicit approval, so that I stay the
    merge authority.
48. As a user, I want the merge to check that the PR is open, not a draft, mergeable and
    green at its current head, so that nothing unverified lands.
49. As a user, I want the merge pinned to the head that was checked, so that a push after
    the check makes the merge fail.
50. As a user, I want red checks never merged unless I waive a specific check, so that
    CI failures are not waved through.
51. As a user of a project with no remote, I want teammates to deliver ready branches
    that land by fast-forward, so that Pivot mode works offline.
52. As a user, I want the Pivot to hear when a PR is merged or closed outside it, or when
    checks go red after "done", so that it reacts to the real world.
53. As a user on Azure DevOps, Bitbucket or Forgejo, I want the delivery gate to work and
    to merge by hand, so that I am not blocked while the Pivot's merge covers GitHub and
    GitLab.
54. As a user, I want scout reports stored with the teammate and kept after cleanup, so
    that findings survive.
55. As a user, I want the Pivot to clean up teammates whose work has landed, without
    asking me, so that finished worktrees and dev servers do not accumulate.
56. As a user, I want cleanup to refuse when work has not landed, so that nothing is
    thrown away without my word.
57. As a user, I want a cleaned-up teammate's history to stay readable, so that I can
    look back at how it got there.

### Restart and recovery

58. As a user, I want a server restart to lose no teammate, decision or pending update,
    so that I can restart without fear.
59. As a user, I want teammates interrupted by a restart to resume by themselves, so that
    work continues without me.
60. As a user, I want the Pivot's first turn after a restart to tell me which teammates
    resumed and which did not, so that I know where things stand.
61. As a user, I want the Pivot to be able to relaunch a dead or wedged teammate in
    place, so that its worktree and history are kept.

### Seeing it all

62. As a user, I want a Pivot in the sidebar with a badge, expandable to its teammates,
    so that I can reach any teammate from the default view.
63. As a user, I want a switch in the header between Chat and Pivot view, and a
    keybinding for it, so that I can move between the two ways of seeing a Pivot.
64. As a user, I want each Pivot to remember whether I last used Chat or Pivot view on
    this device, so that it opens how I left it.
65. As a user, I want the Pivot view to hide the sidebar, so that the screen goes to the
    work.
66. As a user, I want to compose the Pivot view from panes and start from presets, so
    that the screen fits how I work.
67. As a user, I want to hide any pane, bring it back, resize panes and move a pane to
    any edge, so that I can rearrange without starting over.
68. As a user, I want each Pivot to remember its layout on this device, so that I set it
    up once.
69. As a user, I want a card per teammate showing status, title, PR or scout, and
    provider, so that I read the whole team at a glance.
70. As a user, I want attention statuses to stand out on a card, so that what needs
    action is obvious.
71. As a user, I want cards to keep their order, so that nothing jumps under my cursor.
72. As a user, I want finished teammates folded into one "N finished" chip, so that live
    work stays in front.
73. As a user, I want a card's menu to open that teammate's chat, diff, files or preview
    in a pane, so that I inspect exactly what I pick.
74. As a user, I want a teammate's chat in the Pivot view to be read-only apart from
    approvals, so that steering stays with the Pivot.
75. As a user, I want to be able to type into a teammate from the sidebar, and have the
    Pivot told what I said, so that I can intervene directly without the Pivot's record
    going stale.
76. As a user, I want to set a wallpaper behind the Pivot view, with a dim level, so that
    my screen looks the way I like.
77. As a user, I want the Pivot view to stay smooth with many teammates and a wallpaper,
    so that it never costs me frames.

### Notifications

78. As a user, I want to be notified only by the Pivot and only for decisions, ready PRs,
    finished findings and the Pivot's replies to me, so that notifications mean
    something.
79. As a user, I want teammate threads to stop sending their own notifications and
    pushes, so that ten teammates do not mean ten pings.
80. As a user on my phone, I want an escalated decision to reach me as a push, so that I
    can unblock work while away.

### Customizing the Pivot

81. As a user, I want to keep my own standing rules for the Pivot in a file T3 never
    overwrites, so that my preferences survive updates.
82. As a user, I want the Pivot to write a standing preference down when I state one, so
    that I do not repeat myself after a restart or a compaction.
83. As a user, I want the Pivot to talk plainly, so that its messages read like a
    colleague's.

## Implementation decisions

### The model

- **Two optional thread fields,** following the precedent of pull requests, snooze and
  pin: optional on the wire so older clients still decode, one projection column and one
  migration each.
  - `pivot`: set when a thread is created as a Pivot and never cleared. It records
    whether the Pivot is retired and, if so, which Pivot took over.
  - `teammate`: set once by a dispatch event, holding the owning Pivot's thread id, the
    kind (ship or scout) and the latest reported status with the turn it was made in.
- **No third aggregate.** The event store keeps projects and threads only. A thread
  outlives its provider sessions, so a relaunch is a new turn on the same thread, and a
  teammate is 1:1 with its thread and its worktree. This mirrors firstmate's task (the
  durable unit) and endpoint (the replaceable agent session).
- **One active Pivot per project.** The server refuses to create a second Pivot in a
  project whose active Pivot is not retired, unless the command is a takeover.
- **Takeover.** Creating a Pivot while one is active moves every live teammate, open
  decision and pending wake from the active Pivot to the new one in one event, and marks
  the old one retired. A retired Pivot is read-only history: its composer is hidden, and
  its finished teammates stay nested under it.
- **Permanence.** No release, no adoption. A thread is a Pivot or a teammate from
  creation and stays one. Teammates only come from dispatch.
- **Worktrees are required.** The server refuses a dispatch that does not produce a
  worktree, so a teammate can never commit in the primary checkout. Pivot mode needs a
  git repository.
- **Only a Pivot dispatches,** and only into its own project. Nested supervisors are
  impossible by construction.
- **Small shell.** The thread shell gains `pivot` and `teammate: { pivotThreadId, kind,
status }`. The brief (intent, spec, definition of done) rides the dispatch event and
  thread detail, never the shell, because the shell goes to every client for every
  thread.

### Teammate status

- **Reported status.** A teammate reports one of `working` (with a phase line),
  `needs-decision`, `blocked`, `paused` (an external wait, optional `until`), `done` or
  `failed`. Each report is an event scoped to the turn it was made in.
- **Runtime state** comes from what the shell already carries: pending approvals,
  pending user input, session status, background liveness.
- **One pure function** in shared code combines them. The server uses it for the Pivot's
  reads and for wakes. Web and mobile use it for display. Its output is one of eight
  teammate statuses: `working`, `waiting`, `needs-decision`, `blocked`, `paused`, `done`,
  `failed`, `unreported`.
- **Precedence**, in order:
  1. A pending approval or user input is `waiting`.
  2. A running turn or background work is `working`, whatever was reported before.
  3. When idle, the terminal report from the latest turn counts.
  4. When idle with no terminal report in the latest turn: `failed` if the session
     errored, otherwise `unreported`. A session killed by a server restart reads
     `working` while T3 resumes it, and `failed` only if the resume fails.
  5. A terminal report stands over a session error later in the same turn. The error
     shows in the detail.
- Because reports are scoped to their turn, a steered follow-up that ends silently reads
  `unreported`, never a stale `done`.

### Dispatch and the brief

- **The worktree bootstrap moves into a server service.** The logic that today runs
  inside the WebSocket handler (create the thread, fetch, create the worktree, reserve the
  port block, run setup, start the first turn, clean up on failure) becomes a service
  that the WebSocket handler and dispatch both call. The dispatch origin becomes an
  optional argument. The handler keeps a call site.
- **Dispatch inputs:** title, kind, intent (the user's words), spec (the Pivot's
  instructions), optional base branch, optional model selection.
- **The server renders the brief** from a fixed template, copying firstmate's launch
  brief: the teammate role first, so project instructions cannot reassign it; the user's
  intent; the Pivot's spec; the rules (report status through the tool, stay in the
  worktree, full PR URLs, the same obstacle twice means `blocked`, decisions go up); the
  definition of done. The kind and the delivery mode produce the definition of done, never
  the Pivot. The server refuses an empty intent or spec and an intent that opens with a
  speaker label.
- **The brief is the teammate's first message,** carrying a Pivot marker. Runtime
  instructions stay static, so no adapter changes. Every message the Pivot sends a
  teammate carries the same marker and renders as the Pivot's, the brief collapsed. The
  brief is write-once: promotion and new asks append, never overwrite.
- **Model and effort.** The project's default model selection unless the user named one;
  the Pivot's own when the project has none. Effort by firstmate's fallback: low for clear
  work, extra-high for ambiguous design, never max unless asked. No quota profiles.
- **Runtime mode is always full-access,** whatever the project default, because
  firstmate's workers never wait on a human. The `waiting` wake is the safety net.
- **Branch.** The server derives `pivot/<slug of the title>`, adds a suffix if taken, and
  passes it as the final branch, which skips T3's generated rename. The branch never
  changes after dispatch. Scouts get one too.
- **Base.** The origin's default branch, fetched fresh. The Pivot may pass a base branch
  to stack on another branch.
- **Result.** Dispatch returns once the thread and worktree exist and the first turn has
  started. A failing setup script still starts the teammate and the result says so. A
  failing bootstrap returns the error, leaves no teammate, and removes any worktree it
  created.
- **Promotion.** Promoting a scout flips its kind and sends the superseding contract as a
  Pivot message: the ship rules, a new spec, the original intent kept.

### Steering and control

- **Messages** to a teammate take a delivery: `queue` (default) or `steer`. A queued
  message waits on the server and is delivered when the teammate's turn ends. T3 only
  queues in the web client today, so the server-side queue is new. A steered message goes
  into the running turn, which T3's adapters already support.
- **The record is the delivery.** No inbox files, acknowledgements or re-ring: T3
  delivers into the provider session directly. The tool result says queued or delivered.
- **New asks join the intent.** A message can carry the user's words verbatim as
  `intent`, separate from the Pivot's `text`. The server appends them to the teammate's
  recorded intent.
- **Answers close decisions.** A message can name the decision it answers, which closes
  that decision at send time. The send refuses a decision that is not open.
- **Controls** are separate from messages: interrupt, stop and relaunch, each addressed
  to an exact teammate. Teardown and discard are never messages.
- **Exact target or refuse.** Every Pivot tool refuses an empty message and any target
  that is not a live teammate of the calling Pivot.
- **Direct typing.** In the default view, the user can type into a teammate thread from
  the sidebar. The message is recorded as the user's and wakes the Pivot with the text
  verbatim. The Pivot view keeps teammate chat read-only apart from approvals, and an
  approval the user answers there is reported to the Pivot.

### What the Pivot reads

- **List teammates:** one line each (title, kind, status, latest report summary, branch,
  PR, last change, worktree path), copying firstmate's crew-state line.
- **Read a teammate:** a bounded tail of its transcript, newest first, always including
  the latest assistant message, bounded to roughly firstmate's 40-line peek in
  characters. The same read works on the Pivot's retired predecessor.
- **Teammate history:** its status reports and decision events, bounded.
- **Files and diffs:** the Pivot reads the teammate's worktree with its own tools, as
  firstmate's first mate reads projects directly.
- **Scope:** only the calling Pivot's teammates, plus its retired predecessor's
  transcript.

### Waking the Pivot

- **The Pivot supervisor** is a server reactor subscribing to domain events, following
  the existing reactor pattern. It owns everything that happens without a caller: wakes,
  queued-message delivery, rechecks, the stuck bound, the post-restart digest.
- **Wake set:** a teammate reaching `done`, `needs-decision`, `blocked`, `failed`,
  `unreported` or `waiting`; a `paused` teammate's `until` passing, or four hours passing
  with no `until`; a running teammate with no activity for 30 minutes, once per turn,
  never with an automatic interrupt; the user answering an escalated decision; the user
  typing directly into a teammate; delivery events (a PR merged or closed outside the
  Pivot, checks going red after `done`). `working` never wakes. No periodic heartbeat.
- **Batching.** After the first item, the supervisor collects for 30 seconds, then sends
  one wake.
- **Never mid-turn.** A wake waits for the Pivot's current turn to end and never steers
  into it. The user's own messages during a wake turn follow their normal queue or steer
  setting.
- **Content.** A wake is a new message kind in the Pivot thread, sent to the provider as
  text: each teammate that changed since the last wake (title, status, summary), then
  every open decision. The chat renders it as a collapsed notice. When the wake is for a
  stuck or `unreported` teammate, the supervisor attaches firstmate's stuck-teammate
  ladder. For a `failed` one, it attaches the diagnostic-reasoning guidance.
- **Acknowledgement.** Each Pivot has a wake cursor, the event sequence it has been shown
  through. Pending items are the events after it. The cursor advances only when the wake
  turn completes, so an interrupted wake turn shows the same items again. Changes the
  Pivot causes itself never wake it. Pending wakes are derived from events; the recheck
  and stuck timers are rebuilt from state after a restart.

### Decisions

- **One record per decision,** owned by a Pivot and moved with a takeover. It optionally
  links to a teammate and carries a key (`default` when none is given). A teammate's
  `needs-decision` or `blocked` report opens one. The Pivot can open one for its own
  questions. It is not a provider user-input request, because those block the asking
  turn.
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
- **Events:** opened, escalated, answered, closed, marked moot.

### Delivery and merge

- **Modes:** direct-PR for a project with a remote, local-only without one. The mode
  produces the definition of done in the brief.
- **Ready.** In PR mode, `report_status` refuses a ship's `done` without a linked PR
  whose head is pushed. Teammates link PRs with the existing pull-request tool.
  Local-only: `done` names the ready branch.
- **Merge** requires the user's recorded approval of a "PR ready" decision. It reads
  live state and refuses a closed, draft or unmergeable PR, and any check not green at the
  current head, where a required check that never reported counts as not green. It
  reports every failing condition. It passes the verified head to the forge, so a push
  after the check fails the merge. Default method: squash. The only way past a red check
  is an explicit user waiver naming that check.
- **Forges.** The Pivot merges on GitHub and GitLab, the forges firstmate supports. T3's
  existing merge gains head pinning on both. On Azure DevOps, Bitbucket and Forgejo, the
  delivery gate and delivery wakes still work through PR sync, and the user merges by hand.
- **Local landing** is a fast-forward only. A diverged branch refuses and the teammate
  rebases.
- **After a merge** the Pivot posts one line with the full URL.
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

- T3's startup reconciliation already finds sessions that died with the server. Every
  teammate the restart interrupted is resumed in place by the server, whatever the
  project's continue-after-update setting says.
- **Relaunch** resumes the conversation through the provider's resume cursor, as a
  transaction: stop the old session, start the new one, report if that fails.
- **The first wake after a restart is a digest:** which teammates resumed, which failed
  to, and every open decision. A takeover's first turn is the same digest.

### Where the Pivot runs

- **The Pivot home** is a small git repository per project under T3's userdata, shared
  by the project's active Pivot and every retired one. Its files: `AGENTS.md` (the
  contract, owned by T3 and rewritten on update), `CLAUDE.md` pointing at it, and
  `preferences.md` (the user's own rules, never overwritten). The Pivot thread's working
  directory is the home, so the project's own instructions never load into the Pivot,
  relative paths cannot touch the project, checkpoints keep working, and Claude Code,
  Codex and Cursor all find their instructions without adapter changes.
- **"Never write to a project"** is held by the contract, as in firstmate. The Pivot runs
  full-access so it can read teammate worktrees and use `gh`. Where a harness sandboxes
  writes to its working directory, that enforcement comes for free.
- **Capabilities.** The Pivot gets a Pivot capability (dispatch, promote, message,
  interrupt, stop, relaunch, the three reads, decisions, merge, teardown) plus pull
  requests. It gets no browser or device tools; teammates verify. Teammates get a
  teammate capability (`report_status`, the scout report) plus whatever the project
  already grants.

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
  rewritten into this repo's vocabulary; after a compaction or takeover, re-read state
  before acting; read `preferences.md` at start and after a compaction; write to it only
  when the user states a standing preference.
- **No "captain" and no nautical flavor.** A true no-op is one plain line such as
  "Nothing needs you."
- **Ceiling: 3,000 words** always loaded. Situational guidance rides the wake that
  triggers it instead of sitting in the contract.

### Notifications

- In Pivot mode the user hears only from the Pivot: an escalated decision (which covers
  PR ready, destructive or irreversible asks, credential needs, and blockers the Pivot
  cannot clear), finished scout findings, and the Pivot's reply when the user was
  talking to it.
- Teammate threads fire no desktop notifications, sound, badge or mobile push. Their
  events go to the Pivot.
- An escalated decision maps to the relay's existing waiting-for-input phase on the Pivot
  thread, so mobile push needs no new phase.

### The Pivot view and the sidebar

- **Sidebar.** A Pivot sits among the project's threads with a Pivot badge and a count
  of escalated decisions, and expands to its teammates. A retired Pivot keeps its
  finished teammates nested.
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

- **The orchestration engine** (existing). Dispatch commands and assert on the read
  model, as the existing decider and engine tests do. Covers the `pivot` and `teammate`
  fields, one active Pivot per project, takeover and retirement, only-a-Pivot-dispatches,
  the worktree requirement, status report events, the decision lifecycle, and intent
  appends.
- **Teammate status** (new, pure, shared). Every precedence rule as a table of report
  plus runtime inputs to one of eight statuses.
- **The Pivot and teammate toolkits** (existing MCP toolkit pattern). Every agent-facing
  tool and every refusal: dispatch (brief rendering, the speaker-label refusal, branch
  naming, failure cleanup), promote, message with queue and steer, interrupt, stop,
  relaunch, the three reads and their bounds, decisions, merge (approval required, live
  checks, head pinning), teardown (the landed test against a real temporary repository,
  the refusal), `report_status` (the `done` refusal) and the scout report. Capability
  gating: a teammate cannot call Pivot tools and the reverse.
- **The Pivot supervisor** (new, a reactor like the existing settlement reactor). The
  wake set, batching, never mid-turn, cursor acknowledgement across an interrupted wake
  turn, `paused` rechecks, the stuck bound, queued-message delivery at turn end, attached
  guidance, and the post-restart digest. Test clock throughout.
- **The worktree bootstrap service** (extracted). The WebSocket path behaves as before,
  a final branch name skips the rename, and a failed bootstrap removes its worktree.
- **The Pivot home** (new). Creation writes the repository and its files, an update
  rewrites `AGENTS.md` and leaves `preferences.md` untouched, and the contract stays under
  3,000 words.
- **Existing seams, extended.** Restart reconciliation resumes interrupted teammates. The
  GitHub and GitLab merge paths pin the head. The relay publishes no activity for
  teammate threads.
- **Pivot view logic** (new, pure, client). Layout tree operations (presets, hide, show,
  move to an edge, resize, at least one pane) and the card view model (label, attention,
  dispatch order, the finished chip).
- **Sidebar logic** (existing). A Pivot groups its teammates, a retired Pivot keeps its
  finished ones, and teammate threads produce no notifications.

The UI wiring (the Pivot view, the sidebar rows, the header switch, the card menus, the
wallpaper setting) is the last step, verified in one integrated pass in a real client.

## Tasks

1. Create a Pivot thread in a project and read it back as a Pivot in the shell. Seam:
   orchestration engine.
2. Refuse a second Pivot while one is active. Seam: same.
3. Refuse a Pivot in a project that is not a git repository. Seam: same.
4. Record a teammate on its thread with its owning Pivot and kind, and show
   `teammate: { pivotThreadId, kind, status }` in the shell. Seam: same.
5. Refuse a teammate that is not dispatched by the active Pivot of its project. Seam:
   same.
6. Take over: a new Pivot receives every live teammate of the active one, and the old one
   reads retired. Seam: same.
7. Combine report and runtime into the eight teammate statuses, covering every
   precedence rule and the turn scoping. Seam: teammate status.
8. Treat a session killed by a restart as `working` while it resumes. Seam: same.
9. Move the worktree bootstrap into a service and keep the WebSocket path's behavior.
   Seam: worktree bootstrap service.
10. Use a final branch name without a rename, and remove the worktree when the bootstrap
    fails. Seam: same.
11. Create the Pivot home with `AGENTS.md`, `CLAUDE.md` and an empty `preferences.md`,
    and run the Pivot thread in it. Seam: Pivot home.
12. Rewrite `AGENTS.md` on update without touching `preferences.md`, and keep the
    contract under 3,000 words. Seam: same.
13. Grant the Pivot capability only to the active Pivot and the teammate capability only
    to teammates. Seam: Pivot and teammate toolkits.
14. Dispatch a ship: render the brief as the first Pivot-marked message on a
    `pivot/<slug>` branch in a fresh worktree, full-access, and return once the first turn
    starts. Seam: same.
15. Refuse a dispatch with an empty intent or spec, or an intent that opens with a
    speaker label. Seam: same.
16. Dispatch a scout, and promote it in place with a superseding contract. Seam: same.
17. Report a status from a teammate and see it in the shell. Seam: same.
18. Refuse a ship's `done` in PR mode without a linked, pushed PR. Seam: same.
19. Store a scout report on the teammate. Seam: same.
20. List teammates, read a bounded transcript tail, and read status history, scoped to
    the calling Pivot. Seam: same.
21. Read the retired predecessor's transcript after a takeover. Seam: same.
22. Queue a message to a busy teammate and deliver it when its turn ends. Seam: Pivot
    supervisor.
23. Steer a message into a running turn, and append the user's words to the intent.
    Seam: Pivot and teammate toolkits.
24. Interrupt and stop a teammate, and refuse any target that is not a live teammate of
    the caller. Seam: same.
25. Open a decision from a teammate's `needs-decision` or `blocked` report, and from the
    Pivot directly. Seam: orchestration engine.
26. Escalate a decision with its fields, record the user's verbatim answer, and close it
    when the Pivot relays the answer. Seam: Pivot and teammate toolkits.
27. Close a decision as moot with evidence, and let a teammate close its own
    non-escalated blocker. Never close one on a report or at teardown. Seam: orchestration
    engine.
28. Move open decisions with a takeover. Seam: same.
29. Wake the Pivot on the wake set, batched over 30 seconds. Seam: Pivot supervisor.
30. Hold a wake until the Pivot's turn ends. Seam: same.
31. Advance the wake cursor only when the wake turn completes, and show the same items
    again after an interrupted one. Seam: same.
32. Never wake the Pivot for changes it caused itself. Seam: same.
33. Recheck a `paused` teammate at its `until`, or after four hours. Seam: same.
34. Wake once per turn for a running teammate with no activity for 30 minutes, and
    attach the stuck-teammate ladder. Seam: same.
35. Wake on the user's answer to an escalated decision and on the user typing into a
    teammate. Seam: same.
36. Wake on a PR merged or closed outside the Pivot and on checks going red after
    `done`. Seam: same.
37. Merge a teammate's PR on recorded approval after live checks, pinned to the verified
    head, on GitHub. Seam: Pivot and teammate toolkits, with the GitHub merge path.
38. The same on GitLab. Seam: same, with the GitLab merge path.
39. Refuse a merge without approval, on red, or on a closed, draft or unmergeable PR,
    naming every failing condition, and accept a waiver naming one check. Seam: Pivot and
    teammate toolkits.
40. Land a local-only teammate by fast-forward and refuse a diverged branch. Seam: same.
41. Tear down a landed teammate: stop the session, stop its managed processes, remove the
    worktree, release the port block, archive the thread, keep the branch. Seam: same.
42. Refuse teardown of unlanded work, including a squash-merged PR case that counts as
    landed. Seam: same.
43. Resume every teammate interrupted by a restart, and send the restart digest. Seam:
    restart reconciliation and Pivot supervisor.
44. Relaunch a teammate in place and report a failed relaunch. Seam: Pivot and teammate
    toolkits.
45. Publish no relay activity for teammate threads, and map an escalated decision to the
    Pivot's waiting-for-input phase. Seam: relay.
46. Group teammates under their Pivot in the sidebar, keep a retired Pivot's finished
    teammates, and produce no notifications for teammate threads. Seam: sidebar logic.
47. Build and edit the layout tree: presets, hide, show, move to an edge, resize, and at
    least one pane. Seam: Pivot view logic.
48. Derive a card's label, attention, order and the finished chip from the shell. Seam:
    same.
49. Write the Pivot contract from firstmate's judgment text under the ceiling. Seam:
    Pivot home.
50. Wire the UI: the New Pivot entry points with the takeover confirmation, the sidebar
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
- **Nested supervisors, remote hosts, Relay (X/Discord), voice, mail.**
- **Dispatch capping.** Parked in `docs/findings/dev-server-concurrency.md`. The Pivot
  never throttles on host capacity itself. Pivot mode makes the parked measurements
  takeable, because it produces real fleets.
- **"Do X when Y" watches.** Wakes on teammate and delivery events cover this spec.
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
- Several decisions were corrected after being recorded, and the tickets carry the
  amendments: a Pivot started as a project pointer with a pointer-swap handover and a
  release event, and became a permanent thread kind with takeover and retirement;
  decisions moved from the project to the Pivot; teammates' runtime mode moved from the
  project default to always full-access.
- Performance: the shell grows by two small fields per thread; the brief never rides it.
  The layout tree, view choice and wallpaper stay on the client. Cards do not animate.
- Remote readiness: every Pivot record lives on the server, so local, remote and tunnel
  clients see the same state. Only per-device view preferences live on the client.
- Durable decisions and their reasons go into `docs/internals/` as the work lands, as the
  managed-processes effort did. The user guide gets a Pivot mode section.
