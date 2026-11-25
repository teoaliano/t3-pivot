# Map: Teammate positions

Label: `wayfinder:map`
Effort: `teammate-positions`
Charted: 2026-11-02

## Destination

One implementable spec for user-defined teammate **positions** that replace the hard-coded
teammate kinds (ship, scout, inline). From Settings the user creates, edits and deletes
positions: name, when to use, instructions, model, outcome, skills and tools. Reached when
every decision below is made and `to-spec` can synthesize without an interview.

## Notes

**Domain.** Pivot mode in T3 Pivot. Vocabulary lives in `CONTEXT.md` (Position, Outcome,
Teammate, Inline task). The earlier map at `.scratch/pivot-mode/` holds the decisions this
effort reshapes; zoom into its tickets when one is touched.

**Skills every session should consult:** `grilling` + `domain-modeling` (default);
`codebase-design` for What a position is and Migration.

**Settled while charting (2026-11-02), not re-litigated by tickets:**

- A position replaces kind as the teammate's identity. Ship and scout stop being user-facing.
- Every position declares an **outcome**: reports back or delivers a change. For a change
  the Pivot still picks a worktree or the Pivot workspace per task; inline is where a change
  is made, not a position.
- Positions that need the user (PM, UX) report back and ask through the Pivot as decisions.
- A teammate keeps a snapshot of its position taken at dispatch; edits apply to the next one.
- Defaults are ordinary positions: editable, deletable, restorable. Dispatch never fails for
  lack of a position.
- Each position carries its model; `teammateModels` and `teammateKindModelSelections` fold
  into positions. The Pivot can still override the model when the user names one.
- Positions live in environment settings. Web and desktop edit; mobile lists read-only.
- Skills are picked from the skills the environment can see. Tools are on/off per position,
  T3 MCP tools and connected MCP servers enforced by T3, provider built-ins best effort.
- The user's day-one positions, the test cases for every ticket: code reviewer, QA, app
  breaker (hostile data and odd requests), security assessor, UI verifier, animation
  designer (web animation skills), UX designer (usability, accessibility), product manager
  (brainstorms and grills for specs), bug fixer / quick implementer, researcher (web sources).

## Decisions so far

<!-- one line per resolved ticket -->

- [What a position is](issues/01-what-a-position-is.md): server id plus a unique name; required name, when to use, instructions and outcome; optional model (empty runs on the Pivot's model); at most 30, in Settings order; environment-only, no project override; the teammate stores the whole resolved position at dispatch; one `TeammatePositions` service (`list`, `resolve`) owns lookup, fallbacks and model order.
- [What stays fixed in the brief](issues/03-what-stays-fixed-in-the-brief.md): the position's text sits under Your role, before the task; one rule set for everyone, with outcome, delivery mode and workspace only picking the Where-you-work and definition-of-done texts; precedence is T3 rules, then intent, then spec, then position, then project instructions; instructions are now required, and positions that report back can run in the project checkout, read-only.
- [Provider support for skills and tool limits](issues/02-provider-support-for-skills-and-tools.md): Claude and OpenCode can limit skills, tools and MCP per thread; Codex likely via `thread/start` config (unverified); Cursor and Grok partly; Antigravity not at all. Available skills already come from a per-cwd, per-provider cache.

## Not yet specified

- How teammate cards, notifications and the sidebar show a teammate's position.
- Positions for teammates a remote environment hosts (`PivotHost`): whose positions and
  skills apply when the host machine sees different skills. Skill sets differ by provider
  and working directory, so a position's skills can be missing where it runs.
- Whether the teammate concurrency limit (`pivotMaxTeammates`) varies per position.

## Out of scope

- A conversational teammate that talks with the user directly in its own thread.
- Positions defined in the project repo or shared through git.
- The Pivot creating or editing positions itself through MCP (positions are a service, so
  this can come later).
- Editing positions on mobile.
- User-defined lifecycles beyond the fixed outcomes.
