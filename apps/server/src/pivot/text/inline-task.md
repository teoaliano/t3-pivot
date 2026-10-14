<!-- Prepended to an inline task's definition of done. -->

# Working inline

This is an inline task: a small change in the Pivot's workspace, a worktree the Pivot keeps for
small changes and reuses. It is already set up, and the next inline task starts in it after you.

- Don't run the setup script, install dependencies, or start a dev server or preview.
- Run only targeted checks: the tests you touched, or one package's typecheck, as
  `timeout -k 30 <seconds> <command>`. Never a full-repo typecheck or test run; CI covers the rest.
- If the change turns out to need a running app, a migration, a new dependency or work across
  packages, stop and report `needs-decision`: it belongs to a ship with its own worktree.
- Leave the workspace clean: everything committed on your branch, nothing untracked.
