# Teardown and what counts as landed

Type: grilling
Status: open
Blocked-by: 09

## Question

When is a teammate torn down, what does teardown do, and when must it refuse?

firstmate proves the work landed, kills the endpoint, returns the pool slot, and refuses
on unlanded work, treating the refusal as a finding (`bin/fm-teardown.sh`). Decide the
landed test (merged PR, saved scout report, anything else), what teardown does in T3
(archive the thread, stop the worktree's managed processes, remove the worktree, release
its port block), who may trigger it, and the way back: can an archived teammate be
reopened?
