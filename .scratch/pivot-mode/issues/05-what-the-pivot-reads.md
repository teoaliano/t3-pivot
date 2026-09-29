# What the Pivot can read about a teammate

Type: grilling
Status: open
Blocked-by: 02, 03

## Question

What can the Pivot see of a teammate, and how much does each read cost in context?

firstmate's first mate reads a one-line crew state, status tails, and a bounded pane
capture (`bin/fm-crew-state.sh`, `bin/fm-peek.sh`), and treats token efficiency as a
first-class concern. T3 has `getThreadShellById`, `getThreadDetailById` and the
activity queries. Decide the read tools (list teammates, one teammate's state, a bounded
transcript or the latest assistant message, the diff), their size limits, and whether
the Pivot can read threads that are not its teammates.
