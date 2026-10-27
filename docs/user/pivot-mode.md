# Pivot mode

A **Pivot** is a thread you talk to instead of juggling threads yourself. You tell it what you
want done. It dispatches **teammates**, supervises them, reviews their work, answers what it
can, and brings you only the calls that need you and the work that is ready to try. Pivot mode needs the project to be a git repository.

## Start a Pivot

Choose **New Pivot** from the sidebar header, the command palette or its shortcut, then pick the
project. The Pivot runs on the Pivot model set in Settings. A project has one active Pivot at a
time. Starting a new one while one is active asks first, telling you how many live teammates and
open decisions the new Pivot takes over. The old Pivot writes a short handoff of what only its
conversation held, such as plans not yet started and what you were waiting on, and the new one
starts from it. If the old one doesn't answer within about two minutes, the new one starts
without it and tells you. The old Pivot then stays as read-only history. Do this when a
long Pivot conversation gets unwieldy. You don't need to for automatic compaction: the Pivot keeps going
through it.

## Working with it

Describe the work in plain words. A single task goes out straight away. Work that needs more
than one teammate starts with a plan in the Pivot's chat: the pieces, where each runs, what
runs in parallel and how many PRs. Nothing starts until you agree to it there. Teammates run
without stopping for permission prompts, on the project's default model unless you name one.

A **ship** delivers a change in a worktree of its own, or in another ship's worktree when it
builds the next piece of the same PR. A **scout** investigates and leaves a report. It reads
your project's checkout without changing it, so it needs no worktree or install; if a file
there changes anyway while it runs, the Pivot tells you.

Say what you want to see when the work is done, such as "send me screenshots", "I'll try it
in a dev server" or "check it in the browser and report back", and the teammate brings that.
Without a hint, the Pivot picks by the kind of change and tells you which. A finished ship
commits its work and waits: nothing is pushed and no PR exists yet. The Pivot reviews it, and
the teammate's card in the Pivot view shows **Ready for review** with the Pivot's verdict and
the evidence, plus **Try it** when a dev server is part of it. Send feedback through the Pivot,
and the same teammate acts on it. Say "ship it directly" when you dispatch a task you trust,
and it opens its PR as soon as it is done instead.

When you and the Pivot agree the work is finished, it proposes one **ship batch**: the PRs to
open, which teammates' work goes into each, and the order they merge in. Approve it once. Each
PR's lead teammate merges the others' work into its branch, reruns the tests and opens the PR,
and the Pivot merges the PRs in order as their checks pass, on GitHub and GitLab, pinned to the
commit it checked. A PR with red checks holds the ones after it. A conflict after an earlier
merge is fixed under the same approval, unless fixing it changes what the code does, in which
case the Pivot asks you. On other forges you merge by hand. In a project with no remote, each
branch lands on your default branch by fast-forward, in the same order. The Pivot never edits
your project itself, and nothing merges without your approval.

Calls that need you appear above the Pivot's composer until you answer. A merge, a landing or
discarding work asks for your approval: answer with **Accept**, adding a note if you want to waive
a check, or with **Comment**, which needs a note. Your answer is recorded in your words and passed on
to the teammate; after a comment, the teammate makes its change and proposes again.
To check the Pivot's judgment, show the **Decisions** pane in the Pivot view: it lists every
decision, with the answers the Pivot gave on its own labeled as its own.

The Pivot notifies you when it needs a call, when a scout's findings are ready, and when it
replies to you. A teammate notifies you only when its agent stops to ask you a question or for an
approval, which you answer in that teammate's chat. The Pivot stays quiet while it handles the
rest of their updates.

## Seeing it all

In the sidebar a Pivot's row counts its teammates by state, each with its icon: how many need you,
how many are working and how many are done. Clicking a teammate opens its chat, and you can type to
it directly; the Pivot is told what you said.

The switch in a Pivot's header moves between its chat and the **Pivot view**, a full-screen
layout with no sidebar. Start from a layout preset in the view's menu, then show, hide, resize
and move panes. The panes are the Pivot's chat, a card per teammate, one teammate's chat, and
that teammate's preview, files and diff. Open them from a card's menu. A teammate's chat is
read-only in the Pivot view except for approvals; steer it through the Pivot, or type to it from
the sidebar. The view and the layout are remembered per Pivot on each device. An optional
wallpaper sits behind the Pivot view; it is set once per device and shared by every Pivot.

## Your standing rules

Each project's Pivot runs in a small folder of its own under T3's data folder. Put rules you
want it to always follow in `preferences.md` there. T3 never overwrites that file, and the Pivot
adds to it when you state a standing preference, such as "from now on, always ask before
starting more than three teammates."

## After a restart

A Pivot and its teammates carry on by themselves after T3 restarts, whatever the project's
continue-after-update setting says. The Pivot's first update tells you which teammates resumed
and which did not.

## How many run at once

The Pivot runs at most a few teammates at once and queues the rest. Set the number in
**Settings → General → Teammates at once**; left on Auto, it follows your machine's memory on
Linux and has no cap elsewhere.

## When the machine is short of memory

On Linux, a teammate's agent starts only when the machine has memory to spare, and teammates
start one at a time, about 30 seconds apart, so a batch of them never starts together. Until
then its card says **Waiting for memory**, with what the agents use against their limit. It
starts by itself as soon as there is room; stopping the teammate takes it out of line. Every
Pivot on the machine shares one line, across projects and across T3 servers. Your own threads
are held back only when memory is critically short, and fail with a plain memory message after
10 minutes.

Each agent also gets its own memory limit, so one runaway command is throttled inside its own
agent instead of the whole machine. Set `T3CODE_AGENT_SCOPE_MEMORY_HIGH_SHARE` and
`T3CODE_AGENT_SCOPE_MEMORY_MAX_SHARE` (between 0 and 1, defaults 0.5 and 0.75) on the server to
change each agent's share of the agents' total.

## Teammates on another machine

A Pivot can start teammates on another machine you have paired, such as a home server, once that
machine has a **Pivot host link** for it. Pairing and choosing where a teammate runs are not in
the app yet; this note comes first so the trust decision is clear before they are.

A host link is a trust decision. **This gives that Pivot's agents full control of this machine.**
Its teammates run without permission prompts, so they can run commands and read or change any
file the machine's T3 server can, and read its other threads. The link lists the projects the
Pivot may use, but that list only limits what the Pivot can ask for. It does not confine what an
agent does once it is running. Create a host link only for a Pivot you trust, on a machine you are
happy for it to control.
