# Teardown and what counts as landed

Type: grilling
Status: resolved
Blocked-by: 09

## Question

When is a teammate torn down, what does teardown do, and when must it refuse?

firstmate proves the work landed, kills the endpoint, returns the pool slot, and refuses
on unlanded work, treating the refusal as a finding (`bin/fm-teardown.sh`). Decide the
landed test (merged PR, saved scout report, anything else), what teardown does in T3
(archive the thread, stop the worktree's managed processes, remove the worktree, release
its port block), who may trigger it, and the way back: can an archived teammate be
reopened?

## Carried forward from decisions

Teardown never closes a decision (firstmate #3595). Decide what teardown does when the
teammate still has one open: refuse, or proceed and leave the decision open.

## Resolution

**Decided 2026-09-29.**

Adopted from firstmate (`bin/fm-teardown.sh`):

1. **Landed test.** Reachable from a remote-tracking ref, or its PR merged with a head
   containing the local work, or its content already in the up-to-date default branch.
   Local-only also accepts a merge into the local default branch. Uncommitted work never
   counts. Inconclusive refuses (#96).
2. **The Pivot tears down landed work itself,** without asking.
3. **A refusal is a finding.** Discarding unlanded work needs the user's explicit word,
   recorded as a decision answer.
4. **Scout carve-out.** A scout's worktree goes once its report record exists.
5. **A failed close refuses.** If stopping the session fails, teardown refuses before
   touching any record (#4510).
6. **Open decisions stay open.** Teardown proceeds and never closes one (#3595).
7. **What teardown does in T3:** archive the thread, stop the worktree's managed
   processes, remove the worktree through the existing clean-tree check
   (`apps/server/src/storageCleanup.ts:223-362`), and release the port block. The branch
   ref stays.

Drift, agreed with the user:

- **A torn-down teammate can be reopened for reading.** firstmate has no way back. T3's
  unarchive shows the full history. The worktree is gone, so more work means a fresh
  dispatch stacked on the kept branch.

### Net-new

The teardown tool and the landed test. The cleanup, archive and process stop exist.
