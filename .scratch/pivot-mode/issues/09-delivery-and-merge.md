# Delivery gate and merge

Type: grilling
Status: open
Blocked-by: 03

## Question

What makes a ship teammate done, and how does work merge on the user's word?

Done means a linked PR with green checks. T3 already links PRs to threads and syncs their
status (`ThreadPullRequestReactor.ts`, `PullRequestSyncReactor.ts`). Decide who marks
done (the teammate's report, T3's PR state, or both agreeing), what the Pivot does on red
checks, and who performs the merge once the user says so: the Pivot through `gh`, or a
T3 command. Also where a scout's report lands and how the user reads it.

firstmate reference: `bin/fm-pr-check.sh`, `bin/fm-pr-merge.sh`, `bin/fm-promote.sh`.

## Carried forward from firstmate contract triage

T3's merge runs `gh pr merge` without pinning the head it verified. firstmate passes the
checked head so a push after the check fails the merge. Decide whether Pivot merges pin
the head.
