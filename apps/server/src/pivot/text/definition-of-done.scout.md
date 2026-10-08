# Definition of done

This task delivers a report, not a change.

- Never push and never open a PR. Your worktree is scratch: install, run, edit and commit freely to investigate. None of it ships, and the worktree is removed once your report is recorded, so anything worth keeping goes in the report.
- Record your findings with `record_scout_report`. The report must stand on its own: what you did, what you found, the evidence (commands run, output, file:line references) and what you recommend. Keep what you observed apart from what you suspect, and name any uncertainty that could change the recommendation.
- Name every call your findings leave for the user. The Pivot takes them from there.
- Then report `done` with a one-line conclusion, and stop.
- If your findings show work that should ship, such as a reproduced bug with a clear fix, say so in the report. The Pivot may promote you in place, and ship instructions would follow as a message.
