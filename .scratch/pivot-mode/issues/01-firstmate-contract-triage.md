# firstmate contract triage

Type: research
Status: resolved
Blocked-by: none

## Question

Sort firstmate's behavior into four bins, so every later ticket starts from the right
reference instead of rereading 190 scripts:

1. **T3 replaces it.** Terminal and session-manager machinery a GUI host makes
   unnecessary (pane capture, doorbells, treehouse, per-harness wake hooks).
2. **Native mechanic.** Exact behavior T3's server should own (status grammar, steering
   inbox acks, decision holds, teardown refusal, wake acks).
3. **Pivot judgment.** Prose that carries into the Pivot's contract (hard rules,
   escalation format, captain vocabulary, brief writing, captain precedence).
4. **Out of scope** per the map.

Sources: `~/.cache/t3-pivot-refs/firstmate`, starting with `AGENTS.md`, `VISION.md`,
`docs/codex-app-backend.md`, `bin/fm-brief.sh`, `bin/fm-dod-lib.sh`,
`bin/fm-classify-lib.sh`, `bin/fm-task-inbox-lib.sh`, `bin/fm-captain-hold.sh`,
`bin/fm-teardown.sh`, `.agents/skills/ask-user-authority/SKILL.md`.

For each bin-2 mechanic, record the exact rule and the failure it exists to prevent (the
commit or incident, where one is findable). Those reasons are what a rebuild loses first.
For bin 3, list sections with word counts, so the contract ticket can budget.

## Findings

`docs/findings/firstmate-contract-triage.md` (first committed on the
`research/firstmate-contract-triage` branch as `a0288a854`), one table per bin.

## Resolution

- The reference clone is a single commit, 156 commits behind upstream. Upstream cut
  `AGENTS.md` from 11,473 to 6,845 words (#5872). The research used a full clone for
  history.
- About 3,400 words of the clone's `AGENTS.md` are Pivot judgment, plus about 1,800 words
  of skills that carry over. Estimated Pivot contract: 2,000 to 2,500 words.
- Seven native mechanics: the status line grammar, keyed decisions, answerer-closes, the
  steering inbox's pending-until-acked, a durable wake queue cleared only on handling,
  teardown refusal on unlanded work, and recording the user's verbatim answer.
- firstmate contradicts itself on whether a teammate's `done` or `failed` closes its open
  decisions (#3753 closes them, #1842 says never). Ticket 08 picks one.
- One decision record replaces firstmate's two, and the drift guard they needed (#2744).
- T3's PR merge runs `gh pr merge` without pinning the verified head. firstmate passes
  the checked head so a later push fails the merge. T3's worktree cleanup already refuses
  dirty trees and keeps the branch.
- Unowned items, routed: provider and model choice by quota (ticket 04), user
  preferences (fog), "do X when Y" watches (fog), the Pivot hearing about messages the
  user types into a teammate thread (ticket 06).
