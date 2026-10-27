# Pivot view layouts

Type: prototype
Status: resolved
Blocked-by: none

## Question

How are the Pivot view's panes arranged, and how does the user change the arrangement?

The user's sketch: teammate cards above the Pivot's chat, composer at the bottom, no
sidebar. Other arrangements the user wants: chat left with cards right, and a layout with
a browser preview pane. Build a throwaway prototype outside production code to decide
the set of layouts, how one is picked and remembered (per project, per device), what
opening a teammate does to the layout (expand in place, zoom, take over), and how cards
behave at 1, 7 and 20 teammates. The sketch's background image is part of the question:
decoration, a theme, or the user's own wallpaper.

No continuously repainting animation (AGENTS.md "Taste").

## Carried forward from waking the Pivot

The Pivot's chat shows each wake as a collapsed notice the user can expand, for example
"3 teammates changed: auth-fix done, flaky-test needs a decision".

## Carried forward from decisions

Decisions held for the user need a place in the Pivot view that does not scroll away:
a strip, or inline in the chat. The answer UI reuses `ComposerPendingUserInputPanel.tsx`.

## Assets

Clickable sketches of four entry and layout options: `prototypes/index.html` (A sidebar
tabs, B one sidebar with a Chat / Pivot view switch, C mode rail with a Pivot board, D deck
inside the chat). Throwaway, never production code.

## Resolution

**Decided 2026-09-29.** firstmate has no UI, so every decision here is new and the
user's. The sketches in `prototypes/` show the options; the layout tree sketch predates
decision 3 and still shows focus.

1. **Composable panes on a layout tree.** The Pivot view is a tree of row and column
   splits holding panes. The user hides or shows any pane, resizes with dividers, moves a
   pane to an edge through its menu, and starts from presets: teammates top with chat
   bottom, chat left with teammates right, three columns, preview at the bottom. Each
   Pivot remembers its layout per device. Drag-and-drop docking comes later on the same
   tree, so the tree must stay the only layout state.
2. **Panes:** Pivot chat, Teammates, Teammate, Preview, Files, Diff. The last three reuse
   T3's right-panel components (`PreviewPanel`, `FileBrowserPanel`, `DiffPanel`). At
   least one pane stays visible. More pane kinds are new entries later.
3. **Context menus, not focus.** A teammate's card has a menu: View chat, View diff, View
   files, View preview. Each opens that pane for that teammate, or switches the pane to
   it if already open. Clicking the card itself is View chat. A pane names its teammate
   in its header. No hidden "focus" state.
4. **Finished teammates** collapse into one chip at the end of the cards ("10 finished").
   The chip toggles their cards. No row cap: cards wrap, and the pane scrolls if full.
5. **Wallpaper,** the user's call. A Pivot view setting per device, stored on the client
   and never sent over the WebSocket, with a dim level. One static layer behind the
   panes, downscaled to the screen once when picked. No `backdrop-filter` blur over it,
   because blur over live panes is the GPU cost. Panes are solid or plain alpha, and the
   Teammates pane is see-through, as in the user's mockup.
6. **Wake notices** render collapsed in the Pivot chat, and held decisions sit in a strip
   above the composer (tickets 07 and 08).
