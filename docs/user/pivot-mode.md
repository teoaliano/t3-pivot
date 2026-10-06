# Pivot mode

A **Pivot** is a thread you talk to instead of juggling threads yourself. You tell it what you
want done. It dispatches **teammates**, each an agent in its own worktree on its own branch,
supervises them, answers what it can, and brings you only the calls that need you and the
work that is ready for review. Pivot mode needs the project to be a git repository.

## Start a Pivot

Choose **New Pivot** from the sidebar header, the command palette or its shortcut, then pick the
Pivot's agent: Claude Code, Codex or Cursor. A project has one active Pivot at a time. Starting
a new one while one is active takes over its work. The dialog tells you how many live teammates
and open decisions move. The old Pivot stays as read-only history, and the new one can read its
conversation, so plans you only mentioned there are not lost. Do this when a long Pivot
conversation gets unwieldy. You don't need to for automatic compaction: the Pivot keeps going
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
name. On other forges you merge by hand. In a project with no remote, a ready branch lands on
your default branch by fast-forward.

Calls that need you appear above the Pivot's composer until you answer. A merge, a landing or
discarding work asks for your approval: answer with **Approve** or **Decline**, adding a note if
you want to waive a check. Your answer is recorded in your words and passed on to the teammate.

The Pivot notifies you when it needs a call, when a scout's findings are ready, and when it
replies to you. Teammates send no notifications of their own, and the Pivot stays quiet while it
handles their updates.

## Seeing it all

In the sidebar a Pivot shows its teammates nested under it. Clicking a teammate opens its chat,
and you can type to it directly; the Pivot is told what you said.

The switch in a Pivot's header moves between its chat and the **Pivot view**, a full-screen
layout with no sidebar. Start from a layout preset in the view's menu, then show, hide, resize
and move panes. The panes are the Pivot's chat, a card per teammate, one teammate's chat, and
that teammate's preview, files and diff. Open them from a card's menu. A teammate's chat is
read-only in the Pivot view except for approvals; steer it through the Pivot, or type to it from
the sidebar. The view, the layout and an optional wallpaper are remembered per Pivot on each
device.

## Your standing rules

Each project's Pivot runs in a small folder of its own under T3's data folder. Put rules you
want it to always follow in `preferences.md` there. T3 never overwrites that file, and the Pivot
adds to it when you state a standing preference, such as "from now on, always ask before
starting more than three teammates."

## After a restart

A Pivot and its teammates carry on by themselves after T3 restarts, whatever the project's
continue-after-update setting says. The Pivot's first update tells you which teammates resumed
and which did not.
