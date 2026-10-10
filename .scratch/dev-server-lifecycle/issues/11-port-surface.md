# Port surface: placeholder syntax and env var names

Type: grilling
Status: resolved
Blocked-by: —

## Question

Surfaced by [Port allocation](02-port-allocation.md). A worktree now holds a block of ten
ports, and charting settled that ports reach commands via a `{{port}}` placeholder plus
environment variables, never framework detection. The concrete surface is still open, and
it is a **public contract**: it goes into users' `t3.json` files and into commands they
type, so it is expensive to change later.

Decide:
- Placeholder syntax for the first port, and for the other nine. `{{port}}` and
  `{{port:3}}`? `{{port.3}}`? Is an out-of-range index an error at save time or run time?
- Environment variable names. The existing pair is `T3CODE_PROJECT_ROOT` and
  `T3CODE_WORKTREE_PATH` (`packages/shared/src/projectScripts.ts:58`), so the prefix is
  settled; the shape is not. `T3CODE_PORT` plus `T3CODE_PORT_1..9`? A single
  `T3CODE_PORTS` holding a list? Do we also set bare `PORT`, which many frameworks read
  without configuration, or is squatting on a generic name too aggressive?
- Whether the block base is exposed directly, so a project can compute its own offsets.

Keep in view that a project may already read `PORT` from its own `.env`, and that
`extraEnv` is spread last so callers can override.

---

## Resolution

**Decided 2026-09-22.**

### No placeholder syntax. Environment variables only.

Charting assumed `{{port}}` placeholders alongside environment variables. Dropped.

**T3 has no templating convention anywhere.** No `{{...}}` substitution exists in the
codebase, so this would be net-new syntax with its own parser, escaping rules, and a
validation story for an out-of-range index — invented for a job the shell already does.

A user writes `pnpm dev --port $T3CODE_MANAGED_PORT --strictPort` and their shell
substitutes it. `projectScriptRuntimeEnv` (`packages/shared/src/projectScripts.ts:58`)
already injects into project-script runs, so this is adding to an existing list.

The one honest argument for a placeholder is cross-platform syntax, since `$VAR` and
`%VAR%` differ. Rejected because `ProjectScript.command` is already a raw shell string
that is not portable today; a placeholder would fix a fraction of a problem the field
already has.

### Names

`T3CODE_PORT` is **already taken** — it is the T3 server's own port, read by
`apps/desktop/src/app/DesktopConfig.ts:44`, `DesktopBackendConfiguration.ts:80`, and
`apps/web/vite.config.ts:122`. It cannot be reused, and a near-miss like
`T3CODE_DEV_PORT` beside it invites confusion.

- `T3CODE_MANAGED_PORT` — the first port of the checkout's block
- `T3CODE_MANAGED_PORT_1` … `T3CODE_MANAGED_PORT_9` — the rest

One variable per port, so a config file reads a single value with no parsing. A
comma-separated list was rejected because every consumer would have to split a string.
Exposing only a base and letting projects compute offsets was rejected because arithmetic
in a shell or config file is where an off-by-one hides.

Existing neighbours for consistency: `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH`,
both set by the same helper.

### Bare `PORT` is also set, to the first port of the block

Decided explicitly rather than assumed, since it is the only line here that can change a
project's behaviour without being asked.

Most frameworks read `PORT` with no configuration, so this is the difference between a
project working the first time Start is pressed and every project needing an edit. The
failure without it is **silent**: an untouched Next.js project comes up on its own default
of 3000, the preview looks at the reserved port, finds nothing, and shows an empty page
with no indication why.

Accepted risk: a project that reads `PORT` for something other than its dev server, such
as a small API started by the same script, now binds our number instead of its own
default.

Existing mitigations, not new work: `extraEnv` is spread last in
`projectScriptRuntimeEnv`, so a caller can override; and a project's own `.env` is loaded
by its framework after the process environment is inherited, so a project that sets `PORT`
itself still wins.

Reversible in one line. Removing it later only means projects need the edit they would
have needed anyway.
