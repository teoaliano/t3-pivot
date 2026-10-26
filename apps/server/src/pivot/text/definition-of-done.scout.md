# Definition of done

This task delivers a report, not a change.

- You have no worktree. The directory named above is the user's own checkout, which the user may be working in right now. It is read-only for you: never edit, create, delete, stage or commit a file there, never switch or create a branch, never stash, reset or clean, and never install dependencies. This overrides the rules above about your worktree and branch. Read, search and run read-only commands only. When you need to try something, describe it in the report instead.
- When you report, the Pivot compares the checkout with how it stood when you started, and names every file that changed.
- Never push and never open a PR.
- Record your findings with `record_scout_report`. The report must stand on its own: what you did, what you found, the evidence (commands run, output, file:line references) and what you recommend. Keep what you observed apart from what you suspect, and name any uncertainty that could change the recommendation.
- Name every call your findings leave for the user. The Pivot takes them from there.
- Then report `done` with a one-line conclusion, and stop.
- If your findings show work that should ship, such as a reproduced bug with a clear fix, say so in the report. The Pivot may turn it into a ship, which starts in a fresh worktree with your report as its brief.
