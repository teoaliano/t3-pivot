# Entering and leaving Pivot mode

Type: grilling
Status: resolved
Blocked-by: 02, 12

## Question

How does a project get a Pivot, and how does it stop having one?

Decide the entry points (project settings, the command palette, a keybinding, the
sidebar), how the Pivot's provider and model are chosen, how the user moves between the
Pivot view and the default view, and what turning Pivot mode off does to live
teammates (they stay as ordinary threads, or teardown runs). Every way in needs a way
out.

## Carried forward from Pivot and teammate in the orchestration model

The model is `pivotThreadId` on the project, and teammates belong to the project. So
"start a fresh Pivot conversation" is a pointer swap the model already supports. Decide
whether to offer it and where. A release event turns a teammate into an ordinary
thread. Decide when it fires. Pivot mode needs a git repository, so decide what a non-git
project shows.

## Carried forward from where the Pivot runs

Entering Pivot mode creates the Pivot home, a git repo under userdata holding the
contract. The Pivot thread runs there.

## Assets

Clickable sketches of four entry and layout options: `prototypes/index.html` (A sidebar
tabs, B one sidebar with a Chat / Pivot view switch, C mode rail with a Pivot board, D deck
inside the chat). Throwaway, never production code.

## Resolution

**Decided 2026-09-29.** firstmate has no equivalent (you start or stop the agent), so
these are new decisions, all the user's. Design direction: option B from the sketches.

1. **A Pivot is permanent.** No turning Pivot mode off, no release. A Pivot can be shown
   as an ordinary chat (teammates nested under it in the sidebar) or in the Pivot view.
   The model ticket's amendment carries the record change.
2. **Creating a Pivot.** "+ New ▾ → New Pivot" in the sidebar, a command palette action
   and a keybinding. The user picks the provider (Claude Code, Codex, Cursor) and model.
   A non-git project shows "New Pivot" disabled with the reason. Creating one creates the
   project's Pivot home if it does not exist.
3. **One active Pivot, takeover on create.** With a Pivot active, "New Pivot" confirms
   ("this takes over 5 live teammates and 1 open decision from Integrate firstmate"),
   then moves every live teammate, open decision and pending wake to the new Pivot and
   retires the old one. "New Pivot conversation" in the Pivot view's menu is the same
   action. The first turn is the restart digest (ticket 11).
4. **A retired Pivot is read-only history,** and the new Pivot can read its transcript
   with the same bounded read it uses on teammates, which covers plans the user only said
   in the old chat.
5. **Sidebar (option B).** A Pivot sits among the project's threads with a Pivot badge
   and expands to its teammates. Retired Pivots keep their finished teammates nested.
6. **The Chat / Pivot view switch** sits in the header center. A keybinding toggles it.
   Each Pivot remembers its last view on this device. The Pivot view has no sidebar.
7. **Compaction** is the everyday answer to a full Pivot context: all three harnesses
   compact (Claude auto-compact and `/compact`, Codex automatic, Cursor `/compress`). The
   contract survives because it is the Pivot home's `AGENTS.md`. Ticket 14 adds one rule:
   after a compaction, re-read state before acting.
