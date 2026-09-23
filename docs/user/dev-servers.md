# Dev servers

The browser preview can start a project's dev server for you and keep it tied to the checkout
you are working in.

## Start a dev server

Open the browser preview in a thread. Scripts that declare a preview URL, and scripts with the
run icon, are listed under **Dev servers**. Start one there. The preview opens it once the server
serves a page, so a slow first build never shows a connection error.

Each checkout, whether a worktree or the project's main folder, gets its own block of ten ports
starting at 11000, and keeps it. A tab you left open still points at the same checkout tomorrow.

## Use the assigned port

The script receives its ports as environment variables:

- `PORT` and `T3CODE_MANAGED_PORT`: the first port of the block
- `T3CODE_MANAGED_PORT_1` to `T3CODE_MANAGED_PORT_9`: the rest

Most frameworks read `PORT` on their own. For one that does not, pass it in the script, for
example `vite --port $T3CODE_MANAGED_PORT --strictPort`. A `PORT` set in the project's own
`.env` file still wins.

## When a dev server stops

A dev server nobody has used for 30 minutes stops. A visible preview and an agent working in
the checkout both count as use. Pin a server to keep it running. A stopped server stays listed so
you can start it again. Nothing restarts it for you, including a pinned server that exits on its
own.

Removing a worktree stops its dev servers first.

## Port conflicts

If something else already holds the checkout's port, the start is refused and T3 Code names the
process holding it. That process is never stopped. Choose **Use a new port** to move the checkout
to a fresh block.

## Agents

Agents can start the checkout's dev server with the `preview_start_server` tool. They get the same
port and the same idle rule.

## Open the preview automatically

For an action with a preview URL, turn on **Open preview automatically when this action runs**,
or set `autoOpenPreview` in `t3.json`. The preview then opens by itself once that script's dev
server is ready.
