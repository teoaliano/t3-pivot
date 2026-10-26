# Pivot: review, then ship

Spec synthesized on 2026-10-26 from a grilling session on how Pivots and teammates should
behave. It changes the Pivot mode described in `docs/specs/pivot-mode.md`. Vocabulary is in
`CONTEXT.md`: Pivot, retired, teammate, ship, scout, teammate status, decision, Pivot view.

## Problem Statement

Running a Pivot today is heavy on storage, memory and attention.

Every teammate gets its own worktree with a full install, and the dev servers teammates start
linger until a 30-minute idle sweep. A teammate that finishes its work pushes and opens a PR
straight away, because the `done` report requires a linked, pushed PR. The user gets a flood of
PRs and merge approvals before anyone has looked at the work, the merge order matters, and the
grouping of work into worktrees and PRs is decided by the Pivot alone.

When the user retires a Pivot and starts a new one, the new Pivot is told to read the retired
Pivot's whole transcript before acting. Its context fills with history it mostly doesn't need.

## Solution

A teammate does its work, commits it on its own branch, reports `done` with the evidence the
user asked for, and waits. Nothing is pushed and no PR exists yet. The Pivot reviews the diff
and the evidence and posts a short verdict on the teammate. The user tries the work, sends
feedback to the same teammate, or agrees it is finished.

Only when the user and the Pivot agree the work is finished does the Pivot propose one ship
batch: the PRs to open, which branches go into each, and the order. One approval pushes, opens
the PRs and merges them in order as CI passes. A CI failure stops the batch.

Multi-teammate work starts with a plan in the Pivot's chat that the user approves there.
Teammates work in a new worktree or attach to an existing teammate's worktree, following
upstream's workspace kinds; the fork's inline workspace goes away. Scouts read the main
checkout without a worktree.

Dev servers have no cap. Agents start and stop them through managed-process tools, the server
stops a teammate's servers the moment it reports `done`, and the idle sweep drops to 20
minutes.

A retiring Pivot writes a short handoff. The new Pivot starts from that handoff and the live
state from records, and reads the old transcript only when it needs to.

## User Stories

### Dispatch and planning

1. As a user, I want a single small task dispatched straight away, so that simple work has no
   ceremony.
2. As a user, I want work that needs more than one teammate to start with a plan in the
   Pivot's chat (workstreams, a workspace for each, what runs in parallel, how many PRs), so
   that I decide the grouping before work starts.
3. As a user, I want to approve or change the plan by replying in chat, so that planning is a
   conversation and not a card.
4. As a user, I want to say "ship directly" when I dispatch, so that a task I trust skips the
   review wait.
5. As a Pivot, I want to write the evidence a teammate must bring into its brief from hints in
   the user's request, so that the definition of done fits what the user asked for.
6. As a user, I want to say "send me screenshots", "I'll test it in a dev server" or "verify
   it in the browser and report back" and have the teammate deliver exactly that, so that I
   get the evidence I want without restating it.
7. As a user, I want the Pivot to pick evidence from the kind of change when I gave no hint,
   and to name its choice in the dispatch note, so that I can correct it in one line.

### Workspaces

8. As a user, I want each new teammate to get its own fresh worktree by default, so that
   parallel work never collides.
9. As a user, I want a new teammate to attach to an existing teammate's worktree and branch,
   so that the next piece of a PR builds on what is there.
10. As a user, I want attaching to a worktree to be refused while its teammate is working, so
    that two agents never write in one worktree at once.
11. As a user, I want attaching to hand the worktree over, ending the previous teammate and
    keeping the worktree and branch, so that one teammate owns each worktree.
12. As a user, I want no teammate to write in my main checkout, so that my own work there is
    safe.
13. As a user, I want teammate worktrees to fall under the same cleanup rules as every other
    worktree, so that abandoned ones get reclaimed.
14. As a user, I want a teammate whose worktree was reclaimed to keep its branch and be
    relaunchable onto a fresh worktree from it, so that cleanup never loses work.
15. As a maintainer, I want the inline task kind and the shared Pivot workspace removed, so
    that the fork carries one less workspace concept than upstream.

### Scouts

16. As a user, I want scouts to work read-only in the main checkout with no worktree, so that
    research doesn't cost a full install.
17. As a user, I want a scout's report to flag any file it changed in the main checkout, so
    that a provider that can't enforce read-only still can't change my checkout silently.
18. As a user, I want promoting a scout to start a new teammate in a fresh worktree with the
    scout's report as its brief, so that the findings become work without giving every scout
    a worktree.

### Done, review and feedback

19. As a teammate, I want `done` to mean committed on my branch with evidence attached, so
    that I can finish without pushing or opening a PR.
20. As a teammate, I want `done` refused while I have uncommitted work, so that nothing I did
    is left out of the review.
21. As a teammate, I want `done` refused without evidence, so that I never hand back work
    nobody can check.
22. As a user, I want a finished teammate to wait with its session closed, so that it costs
    no memory until I answer.
23. As a Pivot, I want to record a short verdict on a finished teammate's work, so that the
    user sees my review next to the evidence.
24. As a user, I want the verdict and evidence on the teammate's row in the Pivot view, on web
    and mobile, so that I can see what is ready without opening threads.
25. As a user, I want a "start it" control on the teammate when a dev server is part of the
    agreed evidence, so that I can try the change in one step.
26. As a user, I want the ready review to ask nothing of me, so that the only thing that waits
    on my word is shipping.
27. As a user, I want my feedback to go to the same teammate, so that the agent with the
    context and the workspace acts on it.
28. As a user, I want a teammate's verdict cleared when it goes back to work, so that a stale
    review never sits beside changed code.
29. As a user, I want a reviewer agent only when I ask for one, so that review costs nothing
    extra by default.

### Shipping

30. As a user, I want no PR opened until the Pivot and I agree the work is finished, so that
    PRs only exist for work that's ready.
31. As a Pivot, I want to propose one ship batch naming each PR, the teammates whose branches
    go into it, and the order, so that the user approves shipping once.
32. As a user, I want a ship batch refused if it includes a teammate that hasn't reported
    `done`, so that unfinished work can't ship.
33. As a teammate leading a PR group, I want to merge my group's branches into mine, resolve
    conflicts, rerun the tests, push and open the PR, so that one teammate with an environment
    owns the combined change.
34. As a teammate, I want `done` after a ship order to require a linked, pushed PR again, so
    that the existing gate still guards what reaches the forge.
35. As a user, I want the batch's PRs merged in the approved order once CI passes, so that
    stacked work lands correctly.
36. As a user, I want a CI failure to stop the batch, so that nothing lands on top of a broken
    PR.
37. As a user, I want a teammate whose PR conflicts after an earlier merge to update its
    branch, rerun the tests and continue under the same approval, so that mechanical
    conflicts don't need me.
38. As a user, I want the batch to stop and ask me when resolving a conflict changes behavior,
    so that my approval stays honest.
39. As a user, I want every member of a PR group to count as landed when the group's PR
    merges, even with a squash merge, so that their worktrees are cleaned up.
40. As a user of a project with no remote, I want the same single batch approval to land each
    branch in order with `land_teammate`, so that shipping works the same with or without a
    remote.

### Dev servers and resources

41. As an agent, I want to start dev servers only through `preview_start_server`, so that
    every server has a reserved port and can be stopped early.
42. As any agent, not only a teammate, I want a `preview_stop_server` tool, so that I can free
    a server's memory the moment I have my evidence.
43. As a user, I want a teammate's dev servers stopped when it reports `done`, whatever the
    agent remembered, so that waiting teammates hold no servers.
44. As a user, I want the port reservation kept when those servers stop, so that "start it"
    later uses the same address.
45. As a user, I want idle dev servers stopped after 20 minutes instead of 30, so that memory
    comes back sooner.
46. As a user, I want a server with an open preview never stopped, so that what I'm looking
    at stays up.
47. As a user, I want no cap on how many dev servers or teammates run, so that my machine's
    capacity isn't second-guessed by a fixed number.

### Pivot handoff

48. As a user, I want a retiring Pivot to write a short handoff of what only the conversation
    holds (goals, plans not yet dispatched, what I'm waiting on or agreed to, preferences not
    yet saved), so that the new Pivot carries the thread forward.
49. As a user, I want the handoff to include a short note on recently landed work only when it
    matters to what's next, so that the new Pivot isn't loaded with history.
50. As a new Pivot, I want my first wake to carry the handoff plus each active teammate's goal,
    status, worktree, branch and unlanded work, open decisions and pending ship batches from
    records, so that I start accurate.
51. As a user, I want a retiring Pivot that is stuck or broken to never block the takeover, so
    that replacing it always works.
52. As a new Pivot, I want to start from records alone after about two minutes without a
    handoff, told that the conversation part is missing, so that I know to ask or read.
53. As a new Pivot, I want the retired transcript offered, not required, so that I read it
    only when the user refers to earlier work or I need to verify a retired teammate.
54. As a Pivot, I want to read the predecessor's handoff again later, after a compaction, so
    that it is not lost with my context.
55. As a user, I want each handoff to name its own predecessor, so that the chain of Pivots
    stays readable.

## Implementation Decisions

### Dev servers

- The managed processes service's idle threshold drops from 30 to 20 minutes for every
  checkout, Pivot or not. This diverges from upstream's default; it is one constant.
- The managed-process MCP toolkit gains `preview_stop_server` beside `preview_start_server`,
  available to every thread. It stops this checkout's process for a script (the dev action by
  default, matching start's script resolution), waits for the port to be released, keeps the
  port reservation, and succeeds when nothing is running. The handler calls the service's
  existing stop.
- When a teammate's `done` report is accepted, the Pivot stops every managed process in the
  teammate's checkout without releasing the port reservation. The teardown path keeps
  releasing it as today.
- No dev-server or teammate cap is added. The existing optional `pivotMaxTeammates` setting and
  its Linux default are left as they are.

### The done gate and review

- `done` for a ship now requires committed work and evidence. The linked, pushed PR
  requirement applies only once the teammate has been told to ship by an approved batch, or
  was dispatched with "ship directly".
- The `done` report gains an evidence field: free text (steps run and results, test output,
  how to start the server) plus references to attachments the teammate already produces, such
  as screenshots.
- The dispatch input gains an optional flag for "ship directly". It keeps today's behavior for
  that teammate: push and PR at `done`.
- The ready review is not a new record type and not a decision. A new Pivot tool records a
  verdict on a `done` teammate. The verdict, the evidence and whether a dev server is part of
  it live on the teammate record and flow through the existing Pivot stream to the Pivot view.
  A verdict is refused for a teammate that isn't `done`, and is cleared when the teammate
  reports `working` again.
- The "start it" control calls the existing managed-process start for the teammate's checkout.
  Stopping it uses the existing stop.
- Grouping notices that arrive close together needs no new mechanism: the supervisor already
  batches wakes, and the Pivot reports a batch in one reply.

### Workspaces and scouts

- The dispatch input gains an optional reference to an existing teammate whose worktree and
  branch the new teammate attaches to, using upstream's existing-worktree workspace strategy
  with no setup. It is refused while that teammate has a running turn. Attaching ends the
  previous teammate's record and keeps its worktree and branch. The new teammate owns them.
- `baseBranch` stays for new worktrees. It can't be combined with attaching.
- The teammate kind `inline`, the inline dispatch path, the shared Pivot workspace and its
  storage-cleanup exception are removed. A store migration turns any stored inline teammate
  into an ended record so that existing Pivot databases still decode.
- Scouts launch in the project's main checkout with the same empty write scope a Pivot's
  read-only subagents get. Each provider enforces it as far as it can, as documented for
  those subagents.
- At scout dispatch the Pivot records the main checkout's `git status`. When the scout reports,
  any change against that snapshot is listed in the report and named to the Pivot.
- `promote_scout` no longer promotes in place. It dispatches a new ship in a fresh worktree
  with the scout's report as its brief and ends the scout.
- Teammate worktrees already fall under upstream's worktree cleanup rules. A teammate whose
  worktree was reclaimed is listed with its branch and no worktree, and `relaunch_teammate`
  recreates a worktree from that branch.

### Ship batches

- A ship batch is the existing approval decision with a merge order, extended so that each
  entry is a PR group: a lead teammate and the member teammates whose branches merge into the
  lead's. Opening one is refused if any named teammate isn't `done`.
- When the user approves the batch, each lead is told to ship: merge its members' branches,
  resolve conflicts, rerun tests, push, open the PR and report `done` with it linked.
- `merge_teammate` and `land_teammate` take their order from the batch. The existing order
  check means a group whose predecessor hasn't merged is refused, which is what stops the
  batch on a CI failure.
- Approval is not tied to a head SHA today, so a group whose head changed after a conflict fix
  still merges under the same approval. The Pivot instructions require a new decision when the
  fix changes behavior.
- When a group's PR merges, or its branch lands locally, every member counts as landed by
  group membership, not by git ancestry, because squash merges break ancestry.

### Pivot handoff

- On takeover the old Pivot is retired as today, which removes its Pivot tools at once. The
  server then sends it one handoff request. Its reply to that turn is the handoff.
- The handoff is stored on the retired Pivot's record with a new store event, and exposed
  through the Pivot stream so that clients can show it on the retired Pivot.
- The supervisor holds the successor's first wake until the handoff is recorded or about two
  minutes pass, measured on the effect clock. Then the retired thread settles.
- The successor's first wake is the handoff, or a note that it is missing, followed by the
  existing records digest of live teammates and open decisions, extended with pending ship
  batches. It ends with one line naming the predecessor's thread as optional reading. The
  required transcript read is removed from the wake text and the Pivot instructions.
- A new Pivot-only read tool returns the predecessor's handoff and thread id, for use after a
  compaction.
- A reply that arrives after the timeout is ignored.

### Agent text

- The Pivot instructions change to:
  - plan in chat before multi-teammate work
  - derive evidence from the user's hints, or pick by kind of change and name the choice
  - review and record a verdict
  - never propose shipping before the user agrees the work is finished
  - propose one batch
  - stop the batch for behavior-changing conflict fixes
  - read the old transcript only on need
- The teammate brief and the definitions of done change to:
  - commit, attach evidence, report `done` and wait
  - start servers only with `preview_start_server`
  - stop them with `preview_stop_server` as soon as the evidence is captured
  - ship only when told
- Scouts are told they are in the user's checkout and must not write there.

### Docs

- `docs/internals/pivot-mode.md`: rewrite the inline workspace section and the takeover
  section, and record why review comes before PRs.
- `CONTEXT.md`: remove "Inline task" and "Pivot workspace". Add "ship batch", "PR group" and
  "handoff".
- The user guide's Pivot section covers the review-then-ship flow, ship batches and the
  handoff.

## Testing Decisions

- Tests drive public interfaces and assert observable outcomes: refusals and their reasons,
  records the Pivot can list, git state in a real temporary repo, processes the fake V2
  recorded as stopped, wakes delivered. They never assert on internal calls.
- Time-based behavior (the 20-minute sweep, the two-minute handoff timeout) runs on the test
  clock through `TestClock.adjust`. No sleeps or polling.
- Seams, all existing:
  1. **The Pivot MCP toolkit**, called as an agent would, over the shared Pivot harness (real
     Pivot service, store and git; fake V2 threads and forge). It covers the done gate, the
     review verdict, attach and handover, scouts and the checkout check, promotion,
     reclaimed worktrees, ship batches, ordered merge and land, group landing, and stopping
     servers at `done`. Prior art: "merges in the order the user approved, never a PR before
     what it stacks on", and "a scout reports, then is promoted in place with a superseding
     contract".
  2. **The Pivot supervisor**, with the test clock. It covers the handoff request, the
     successor's first wake and the timeout. Prior art: "a takeover opens the new Pivot with a
     digest of every teammate and decision".
  3. **The managed processes service**, with the test clock. It covers the 20-minute sweep.
     Prior art: "reaps a process nobody has wanted for thirty minutes".
  4. **The managed-process MCP toolkit.** It covers `preview_stop_server`. Prior art: the
     `preview_start_server` handler tests.
- Prompt text has no automated test. It is reviewed by reading.
- Inline-task tests are deleted with the feature, not rewritten.

## Tasks

1. Stop an idle dev server after 20 minutes, and keep one idle for 19. Seam: managed
   processes service.
2. Stop this checkout's dev server with `preview_stop_server` and keep its port reservation.
   Seam: managed-process MCP toolkit.
3. Succeed with nothing to do when `preview_stop_server` finds no running server. Seam: same.
4. Stop every managed process in a teammate's checkout when its `done` is accepted, keeping
   the reservation. Seam: Pivot MCP toolkit.
5. Accept `done` from a ship in a project with a remote when its work is committed and
   evidence is attached, with nothing pushed and no PR. Seam: same.
6. Refuse `done` without evidence. Seam: same.
7. Keep requiring a linked, pushed PR at `done` for a ship dispatched with "ship directly".
   Seam: same.
8. Record the Pivot's verdict on a `done` teammate and list it with the evidence. Seam: same.
9. Refuse a verdict for a teammate that isn't `done`. Seam: same.
10. Clear a teammate's verdict when it reports `working` again. Seam: same.
11. Attach a new teammate to an existing teammate's worktree and branch, without setup. Seam:
    same.
12. Refuse to attach while that teammate has a running turn. Seam: same.
13. End the previous teammate when another attaches, keeping the worktree and branch. Seam:
    same.
14. Refuse `baseBranch` combined with attaching. Seam: same.
15. Remove the inline kind, its dispatch path and the shared Pivot workspace, migrating stored
    inline teammates to ended records. Seam: same (the dispatch input no longer accepts
    inline, and an old database still decodes).
16. Launch a scout in the main checkout with an empty write scope and no worktree. Seam: same.
17. Name files a scout changed in the main checkout when it reports. Seam: same, with real git.
18. Promote a scout into a new ship in a fresh worktree with the report as its brief, ending
    the scout. Seam: same.
19. List a teammate whose worktree was reclaimed with its branch, and relaunch it onto a fresh
    worktree from that branch. Seam: same.
20. Open a ship batch of PR groups in order, and refuse one naming a teammate that isn't
    `done`. Seam: same.
21. Require a linked, pushed PR at `done` once a lead has been told to ship by an approved
    batch. Seam: same.
22. Merge the batch's groups in order, and refuse a later group while an earlier one is
    unmerged, as after a CI failure. Seam: same.
23. Merge a group whose head changed after approval without a new approval. Seam: same.
24. Count every member of a group as landed when the group's squash-merged PR merges, and
    allow their teardown. Seam: same.
25. Land an approved batch in order with `land_teammate` in a project with no remote. Seam:
    same.
26. Send a retired Pivot one handoff request on takeover and record its reply on its record.
    Seam: Pivot supervisor.
27. Open the successor with the handoff, the records digest including pending ship batches,
    and the optional transcript line, with no required read. Seam: same.
28. Open the successor from records alone with a "handoff missing" note after two minutes
    without a reply, settle the retired Pivot, and ignore a late reply. Seam: same, on the
    test clock.
29. Return the predecessor's handoff and thread id from the Pivot's handoff read tool. Seam:
    Pivot MCP toolkit.
30. Show the verdict, evidence and "start it" control on the teammate row, the batch's PR
    groups on its decision, and the handoff on a retired Pivot, in the web and mobile Pivot
    views. Seam: none beyond the stream contract; verified in one integrated client pass on
    request.
31. Rewrite the Pivot instructions, teammate brief, definitions of done and scout text for the
    new flow. Seam: none; reviewed by reading.
32. Update `docs/internals/pivot-mode.md`, `CONTEXT.md` and the user guide's Pivot section.
    Seam: none.
33. Measure the disk cost of one teammate worktree with pnpm on APFS, and record the number
    in the PR. Seam: none; a measurement.

## Out of Scope

- Any cap or admission control on dev servers or teammates. The user ruled out a fixed number
  because it misjudges the machine. Efficiency comes from stopping servers early.
- A shared dependency store for worktrees, unless the measurement in task 33 shows the disk
  cost is bad.
- A shorter idle sweep for checkouts with no running agent. It would stop normal threads'
  servers while the user switches tabs.
- A ready-review record type or decision. The verdict lives on the teammate.
- Expiring a waiting teammate. Upstream's cleanup rules reclaim its worktree; its branch
  survives.
- Running several agents in one worktree at once, and any teammate writing in the main
  checkout.
- A reviewer agent by default. One runs only when the user asks.
- Handoffs written on a schedule or after every turn.
- Changing the `pivotMaxTeammates` setting or the Linux memory guard.

## Further Notes

- Read-only enforcement for scouts varies by provider. Codex blocks writes. Claude loses Edit
  and Write but keeps an unsandboxed shell. Cursor, Antigravity, Muse and Pi rely on the
  instructions. The checkout check in task 17 is what catches a slip on every provider.
- `docs/findings/dev-server-concurrency.md` explored admission, queues and leases. This spec
  takes only the early-stop direction from it and drops the rest, per the user.
- The 20-minute sweep is a first value. The user expects to adjust it if it proves too short.
