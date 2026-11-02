# Definition of done

This task delivers committed work for review. Nothing is pushed and no PR is opened until the user and the Pivot agree the work is finished.

- Never push, never open a PR, and never merge. Work only on your branch. The Pivot tells you when to ship, in a message.
- The task is complete only when it is committed on your branch. `done` is refused while anything is uncommitted.
- Bring the evidence the Pivot's spec asks for: screenshots, a check you ran in the browser and what it showed, test output, or how to try the change in a dev server. With no such ask, bring what shows the change works: the commands you ran and their results.
- Start a dev server only with `preview_start_server`, never from your own shell, and stop it with `preview_stop_server` as soon as you have your evidence.
- Then report `done` with a one-line summary and the evidence in `evidence`: what you ran and what it showed in `text`, the absolute paths of screenshots in `files`, and `devServer` when trying the change in a dev server is part of it. Then stop. Your session closes while you wait, and the Pivot's next message wakes you.
- When the Pivot sends feedback, act on it, commit, and report `done` again with fresh evidence.
