# Expanded teammate

Type: prototype
Status: resolved
Blocked-by: 15

## Question

What does the user see after opening a teammate, and how do they get back?

Settled: the teammate's chat is read-only except for pending approvals. The user also
wants to inspect the teammate's worktree and its dev server. Prototype the expanded
state: the chat, the diff or file view, the managed processes and preview (reusing the
managed-processes preview), and the close action back to the Pivot view.

## Carried forward from dispatch and the brief

The teammate's chat shows Pivot messages as the Pivot's words, with the long brief
collapsed.

## Carried forward from steering

The teammate's composer is hidden in the Pivot view. In the default view it stays, and
direct messages wake the Pivot.

## Resolution

**Decided 2026-09-29,** mostly by the layouts ticket: there is no separate expanded
state. Opening a teammate means its Teammate pane, plus Diff, Files and Preview panes
from the card's menu.

1. **Teammate pane.** The teammate's chat, read-only in the Pivot view: composer hidden,
   the brief collapsed, Pivot messages marked as the Pivot's (tickets 04, 06). Pending
   approvals stay answerable, and T3 tells the Pivot the user answered.
2. **Preview pane** shows the teammate's managed processes and their preview, reusing
   the managed-processes preview and its start, stop and pin controls.
3. **Diff and Files panes** show the teammate's worktree.
4. **Getting back.** A pane's menu hides it. The Pivot view never loses its other panes
   while a teammate is open, so there is no "close and return".
5. **Default view.** The same teammate thread opened from the sidebar is an ordinary
   chat with its composer, and direct messages wake the Pivot (ticket 06).
