# The Pivot's contract

Type: grilling
Status: resolved
Blocked-by: 01, 04, 05, 06, 08, 09, 10, 12

## Question

What goes into the instructions the Pivot always carries, where do they live, and what
is their size ceiling?

Start from ticket 01's bin 3: firstmate's hard rules, escalation etiquette, captain
vocabulary, brief writing and captain precedence. Decide what carries over, what the
tool descriptions already say, the word ceiling (firstmate states one: 9,000 words), and
where the text lives (`apps/server/src/provider/RuntimeInstructions.ts`, a file the user
can edit, or both). Note per-harness differences for Claude Code, Codex and Cursor.

## Carried forward from decisions

The Pivot's authority rule is `ask-user-authority`: answer what is unambiguous toward the
user's intent, escalate contract expansion, unsettled product or architecture calls, and
destructive, irreversible or security-sensitive choices.

## Carried forward from where the Pivot runs

The contract is the Pivot home's `AGENTS.md`, with `CLAUDE.md` pointing at it. Decide how
T3 ships updates to it when the user has edited it.

## Carried forward from entering and leaving

After a compaction, the Pivot re-reads its state (`list_teammates`, open decisions)
before acting. After a takeover, its first turn is the restart digest, and it can read
the retired Pivot's transcript.

## Resolution

**Decided 2026-09-29.** The contract copies firstmate's bin 3 judgment
(`docs/findings/firstmate-contract-triage.md`, §3), trimmed of script names, yolo and no-mistakes.

Adopted from firstmate:

1. **Hard rules.** Never write to a project, except a concrete user-approved operation.
   Never merge without the user's word. Never tear down unlanded work. A direct user
   instruction to a teammate is authoritative. Report failures plainly.
2. **Identity.** The Pivot never does project work itself; even trivial changes go to a
   teammate.
3. **Intake.** Ship by default. Scout only for a requested report or uncertainty that
   could change what to build. Relay existing evidence instead of commissioning a scout.
   Dispatch isolated work in parallel; serialize only for a true dependency.
4. **Delivery and merge judgment.** Resolve the mode per task, the user's current
   instruction first. No invented review gates. Never merge red. Destructive,
   irreversible and security-sensitive merges escalate.
5. **Mid-task changes.** New asks join the intent. Late requirements become follow-up
   work unless they invalidate the task.
6. **Escalation and etiquette.** Talk in outcomes. The final message stands alone. Use
   the user's nouns. Never relay status lines verbatim. Escalations carry evidence,
   consequence, options and a recommendation. The escalate-now list (ticket 18). Ask only
   when the next step needs the user; batch the rest. Full PR URLs.
7. **Briefs.** Fill intent with the user's ask and never widen it. Put only what the ask
   requires in the spec and name what stays out.
8. **Captain precedence.** A current, explicit, concrete instruction beats standing rules
   within its exact scope, never inferred, broadened or carried over. Destructive and
   merge actions still need the user to name them.
9. **Knowledge routing.** Durable project knowledge goes into the project's `AGENTS.md`
   through a teammate, never written by the Pivot.
10. **Decision rule:** `ask-user-authority` (ticket 08).
11. **Translation list** rewritten into this repo's vocabulary (`CONTEXT.md`).
12. **After a compaction or takeover,** re-read state (`list_teammates`, open decisions)
    before acting (ticket 13).

Mechanism swaps, same guarantee:

- **Situational skills ride the wake.** firstmate moved situational text into triggered
  skills (#5872). T3 attaches the skill text to the wake that triggers it: the
  stuck-teammate ladder (`stuck-crewmate-recovery` lines 67-79) to an `unreported` or
  stuck wake, `diagnostic-reasoning` to a `failed` one. They stay out of the
  always-loaded text.
- **Ceiling 3,000 words** for the always-loaded contract (firstmate's is 9,000 for a
  larger surface). A change that would cross it moves text into a wake-attached skill.
- **Per harness:** Claude Code reads `CLAUDE.md`, which points at `AGENTS.md`. Codex and
  Cursor read `AGENTS.md`. No adapter changes.

Drifts, agreed with the user:

1. **No "captain", no nautical flavor.** The Pivot talks plainly. firstmate's
   "Captain, shipshape." no-op becomes one plain line such as "Nothing needs you."
2. **Two files in the Pivot home, copying firstmate's `AGENTS.md` and `captain.md`
   split.** T3 owns `AGENTS.md` and rewrites it on update. The user's own rules go in
   `preferences.md`, which T3 never overwrites. The contract tells the Pivot to read it
   at start and after a compaction. The Pivot writes to `preferences.md` only when the
   user states a standing preference. Editing `AGENTS.md` directly is lost on the next
   update. This settles the map's "durable preferences" fog.
