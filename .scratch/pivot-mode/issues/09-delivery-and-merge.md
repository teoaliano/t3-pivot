# Delivery gate and merge

Type: grilling
Status: resolved
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

## Carried forward from teammate status

`report_status` is a server-side tool, so it can refuse a ship's `done` that has no
linked PR, or whose head is not pushed (firstmate #4878). Decide whether it does.

## Carried forward from dispatch and the brief

The kind and the delivery mode produce the teammate's definition of done in the brief
template. Decide the modes (firstmate's direct-PR and local-only; no-mistakes is out)
and the definition of done for each.

## Resolution

**Decided 2026-09-29.**

Adopted from firstmate (`bin/fm-dod-lib.sh`, `bin/fm-pr-check.sh`, `bin/fm-pr-merge.sh`,
`bin/fm-merge-local.sh`):

1. **Modes.** Direct-PR for a project with a remote, local-only without one. No-mistakes
   is out. The mode produces the definition of done in the brief.
2. **Ready signal.** In PR mode, `report_status` refuses a ship's `done` without a linked
   PR whose head is pushed (#4878). Teammates link PRs with the existing
   `link_pull_request` tool. Local-only: `done` names the ready branch.
3. **Merge only on the user's recorded word.** "PR ready" escalates as a decision, and
   the merge tool requires that approval (#3710).
4. **Live checks before merge.** Open, not a draft, mergeable, every check green at the
   current head, a required check that never reported is not green (#5534). Every
   failing condition is reported.
5. **Pinned head.** The merge passes the verified head to the forge, so a later push
   fails it (#4199). T3's merge (`GitHubPullRequestCli.ts:2538-2546`) gains this.
   Default method squash, as firstmate on GitHub.
6. **Red never merges,** except an explicit user waiver naming one check.
7. **Local landing** is a clean fast-forward only. A diverged branch refuses and the
   teammate rebases.
8. **After a merge,** one line with the full URL.
9. **Delivery wakes.** A PR merged or closed outside the Pivot, or checks going red after
   `done`, wake the Pivot (firstmate's `check` wake kind). T3's PR sync
   (`PullRequestSyncReactor.ts`) supplies the events.
10. **Scout reports** are stored as a record on the teammate, readable by the Pivot and
    in the expanded teammate, and survive teardown, as firstmate keeps them outside the
    worktree. The Pivot tells the user "finished findings", firstmate's escalate-now item.

Drift, agreed with the user:

- **The Pivot merges on GitHub and GitLab only,** the forges firstmate supports. On the
  other forges T3 knows (Azure DevOps, Bitbucket, Forgejo) the done gate and delivery
  wakes still work through PR sync, but the user merges by hand, and the Pivot sees the
  merge through sync. No merge logic for forges the user cannot test.

### Net-new

Head pinning on T3's GitHub and GitLab merge, the merge tool with its approval check,
the `done` refusal, and the scout report record.
