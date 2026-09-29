# Where the Pivot runs and what it may touch

Type: grilling
Status: open
Blocked-by: 02

## Question

Which checkout does the Pivot run in, and how is its "read projects, never change them"
rule held?

firstmate's first hard rule is that the first mate never writes to a project, and even
trivial changes are a teammate's job. Decide the Pivot's working directory (the project's
main checkout, or a dedicated read-only place), and whether the rule is enforced by T3
(runtime mode, sandbox, provider settings, per harness for Claude Code, Codex, Cursor)
or held by the contract alone. Include which MCP capabilities the Pivot gets and which
teammates get.
