# Where the Pivot runs and what it may touch

Type: grilling
Status: resolved
Blocked-by: 02

## Question

Which checkout does the Pivot run in, and how is its "read projects, never change them"
rule held?

firstmate's first hard rule is that the first mate never writes to a project, and even
trivial changes are a teammate's job. Decide the Pivot's working directory (the project's
main checkout, or a dedicated read-only place), and whether the rule is enforced by T3
(runtime mode, sandbox, provider settings, per harness for Claude Code, Codex, Cursor)
or held by the contract alone. Include which MCP capabilities the Pivot gets and which
teammates get.

## Carried forward from teammate status

Teammates get a teammate-only capability for `report_status`.

## Carried forward from dispatch and the brief

`dispatch_teammate` and `promote_teammate` are Pivot-only tools.

## Carried forward from what the Pivot reads

The Pivot reads teammate worktrees with its own tools (diffs, files), so its permissions
must allow reading those paths while forbidding writes.

## Resolution

**Decided 2026-09-29.** No drifts.

Adopted from firstmate:

1. **The Pivot runs in its own home,** never in the project, as the first mate runs in
   its home. T3 creates a small git repo per project under userdata. It holds the
   Pivot's contract as `AGENTS.md`, with `CLAUDE.md` pointing at it, as firstmate does.
   The Pivot thread's working directory is that home.
   - The project's own `AGENTS.md` never loads into the Pivot. That is the reverse of
     firstmate's role-override problem (#3797).
   - Relative paths cannot touch the project.
   - Claude Code, Codex and Cursor all load instructions from the working directory,
     so no adapter changes. Runtime instructions stay static.
   - Checkpoints keep working, because the home is a git repo.
2. **"Never write to a project" is held by the contract,** as firstmate's hard rule 1.
   Where a harness sandboxes writes to its working directory (Codex workspace-write),
   that enforcement comes for free.
3. **The Pivot runs full-access,** so it can read teammate worktrees and use `gh`.
4. **Capabilities.**
   - The Pivot: the Pivot toolkit (dispatch, promote, message, interrupt, stop,
     relaunch, the three reads, decisions, merge, teardown) plus pull requests. No
     browser or device tools, because teammates verify.
   - Teammates: `report_status` and the scout report tool, plus whatever the project
     already grants (`ProviderService.ts:906-914`).

### Net-new

The Pivot home and its creation, and the two capabilities.

### Knock-on

- Ticket 13: entering Pivot mode creates the Pivot home. Turning it off keeps it.
- Ticket 14: the contract is the Pivot home's `AGENTS.md`.
- Fog: the Pivot's durable preferences can live in the Pivot home, as firstmate's
  `data/`.
