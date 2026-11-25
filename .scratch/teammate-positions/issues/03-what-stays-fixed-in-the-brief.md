# What stays fixed in the brief

Type: grilling
Status: resolved
Blocked-by: 01

## Question

Which parts of the teammate's first message stay T3's and which come from the position?

`apps/server/src/pivot/text/teammate-brief.md` and the `definition-of-done.*.md` texts mix
the protocol every teammate must follow (report_status, worktree rules, decisions go up,
commit and push) with role text (what a scout does). Decide the fixed protocol per outcome,
where the position's instructions sit, which wins on conflict, and what the Pivot's spec
still carries per task. Keep the existing order rule: the role section comes before any
project instruction.

## Resolution

**Decided 2026-11-03.**

### The brief, top to bottom

1. **Your role**: T3's fixed teammate paragraph, unchanged and not editable.
2. **Your position: {{name}}**: the position's instructions, then one line naming its skills
   ("Skills for this position: …, use them where they apply"). This keeps the order rule:
   who the teammate is comes before any project instruction.
3. **Task**: "You are the {{name}}. This task {{reports back | delivers a change}}.", then
   the user's intent and the Pivot's spec, as today.
4. **Where you work**: one of two texts, picked by the position's workspace.
   - *Own worktree*: today's text with the isolation check, plus rule 1's worktree sentences.
   - *Project checkout, read-only*: "You work in `{{projectRoot}}`, the project's own
     checkout, which the user may be using. Read only: don't edit, create or delete files,
     commit, install, switch branches, or start servers." It has no isolation check.
5. **Rules**: the same for every position. Rule 5 (record the report) and rule 8 (when work
   is done) move into the definitions of done.
6. **Definition of done**: one of four, picked by outcome and delivery mode:
   - reports back (today's scout text, without the word "scout"; the "your worktree is
     scratch" line only when the teammate has a worktree);
   - delivers a change as a PR;
   - delivers a change merged locally;
   - delivers a change inline (with the inline preamble).

The server branches on outcome, delivery mode and workspace only to pick these texts. Renaming
`record_scout_report` is left to Migration.

### Which text wins on a conflict

Highest first: T3's rules and definition of done, then the user's intent, then the Pivot's
spec, then the position's instructions, then project instructions. A conflict between the
intent and the spec is still reported as `needs-decision`. So is a spec that would break a
hard limit in the position's instructions, rather than the teammate choosing.

### Positions that ask the user questions

The protocol stays as it is. A Product manager asks in rounds through `needs-decision`, as its
own instructions say. Rule 4 already lists product choices as decisions that go up.

### Amendments to What a position is

- **Instructions are required**, at most 20,000 characters.
- **New workspace field**, only for positions that report back: "own worktree" (the default)
  or "project checkout, read-only". With the read-only checkout, T3 turns off file-editing
  tools where the provider allows (Claude's Edit and Write, Codex's read-only sandbox). Shell
  commands can still write, so this is best effort. Several such teammates can run at once.
  A position that delivers a change always gets a worktree or inline, as the Pivot picks.
