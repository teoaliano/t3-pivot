# Pivot mode

A **Pivot** is a thread you talk to instead of juggling threads yourself. You tell it what you
want done. It dispatches **teammates**, each an agent in its own worktree on its own branch,
supervises them, answers what it can, and brings you only the calls that need you and the
work that is ready for review. Pivot mode needs the project to be a git repository.

## Start a Pivot

Choose **New Pivot** from the sidebar header, the command palette or its shortcut, then pick the
project. The Pivot runs on the Pivot model set in Settings. A project has one active Pivot at a
time. Starting a new one while one is active asks first, telling you how many live teammates and
open decisions the new Pivot takes over. The old Pivot stays as read-only history, and the new
one can read its conversation, so plans you only mentioned there are not lost. Do this when a
long Pivot conversation gets unwieldy. You don't need to for automatic compaction: the Pivot keeps going
through it.

## Working with it

Describe the work in plain words. The Pivot dispatches a teammate for each independent piece,
using the project's default model unless you name one. Teammates run without stopping for
permission prompts. A **scout** investigates and leaves a report; a **ship** delivers a change.

The Pivot updates you as teammates finish, fail, block or need a call. It never edits your
project itself, and nothing merges without your approval. In a project with a remote, a
teammate's work counts as done only once its pull request exists with its latest commit pushed.
The Pivot gives you the full PR link. When you approve, it merges the PR on GitHub and GitLab,
pinned to the commit it checked. Red checks block the merge unless you waive a specific check by
name. When several PRs are open, the approval shows the order they merge in, and the Pivot
refuses to merge a PR before the work it builds on. On other forges you merge by hand. In a project with no remote, a ready branch lands on
your default branch by fast-forward.

Calls that need you appear above the Pivot's composer until you answer. A merge, a landing or
discarding work asks for your approval: answer with **Accept**, adding a note if you want to waive
a check, or with **Comment**, which needs a note. Your answer is recorded in your words and passed on
to the teammate; after a comment, the teammate makes its change and proposes again.

The Pivot notifies you when it needs a call, when a scout's findings are ready, and when it
replies to you. A teammate notifies you only when its agent stops to ask you a question or for an
approval, which you answer in that teammate's chat. The Pivot stays quiet while it handles the
rest of their updates.

## Seeing it all

In the sidebar a Pivot's row counts its teammates by state, each with its icon: how many need you,
how many are working and how many are done. Clicking a teammate opens its chat, and you can type to
it directly; the Pivot is told what you said.

## Your standing rules

Each project's Pivot runs in a small folder of its own under T3's data folder. Put rules you
want it to always follow in `preferences.md` there. T3 never overwrites that file, and the Pivot
adds to it when you state a standing preference, such as "from now on, always ask before
starting more than three teammates."

## After a restart

A Pivot and its teammates carry on by themselves after T3 restarts, whatever the project's
continue-after-update setting says. The Pivot's first update tells you which teammates resumed
and which did not.

## Small changes run inline

For a small, self-contained change, such as a typo, a one-file fix or a docs edit, the Pivot
runs an inline task instead of a full teammate. It works in the Pivot's workspace, a copy of
the project the Pivot sets up once and reuses, so it starts without a new worktree, setup
run or dev server, and runs only targeted checks. It still delivers a PR for your approval,
and its card is marked **Inline**. One runs at a time per project. When it isn't clear
whether a change is small enough, the Pivot asks you.

The Pivot runs at most a few teammates at once and queues the rest. Set the number in
**Settings → Threads → Teammates at once**; left on Auto, it follows your machine's memory on
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
