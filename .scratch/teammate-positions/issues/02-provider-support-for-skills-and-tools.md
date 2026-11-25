# Provider support for skills and tool limits

Type: research
Status: resolved
Blocked-by:

## Question

For each provider adapter (Codex, Claude, Cursor, Grok, OpenCode, Antigravity), what can
T3 control per thread?

1. Skills: where does the provider discover skills (user, project, plugin dirs), can a
   thread be started with a chosen subset, and does T3 already pass anything like this?
2. Tools: can built-in tools (shell, edit, web) be allowed or denied per thread? How does
   T3 already scope its own MCP tools per thread (see `PivotToolRestrictions.ts`,
   `ThreadToolRestrictions`), and can connected MCP servers be included or excluded?
3. What "the skills the environment can see" means concretely, and whether the server can
   list them cheaply for the Settings editor.

Answer per provider with source references (adapter code in `apps/server/src/provider*`,
provider docs). Mark "not supported" plainly.

## Resolution

**Resolved 2026-11-02.** Findings: [research/provider-support-for-skills-and-tools.md](../research/provider-support-for-skills-and-tools.md).

- **Claude**: all three per thread. SDK `skills` allowlist, `tools` / `disallowedTools`
  for built-ins, MCP servers via `strictMcpConfig` or `mcp__x__*` denies. T3 already sets
  `tools` (`ClaudeAdapterV2.ts`), never passes `skills`.
- **OpenCode**: all three through per-session permission rules (skill name patterns, tool
  rules, MCP tool globs). T3 already scopes its own MCP server this way.
- **Codex**: T3 sends a `config` map on `thread/start`; config keys exist for skills,
  shell, web search and MCP servers. Whether they apply per thread is unverified.
- **Cursor**: no skill subset; `tools` / `disallowedTools` documented but unconfirmed on the
  pinned SDK; MCP only by dropping a whole settings layer.
- **Grok**: `--tools` / `--disallowed-tools` CLI flags; skills and MCP per thread unknown.
- **Antigravity**: none per thread; user MCP servers never load under T3's private profile.
- **T3's own MCP tools**: one server for every thread, a per-thread credential gates
  capabilities at call time, and a thread's tool list can already hide tools (used for PR
  tools on subagents). T3 keeps no list of user-connected MCP servers.
- **Available skills**: the union of each provider's skill list, cached per working
  directory for 5 minutes and already used by the composer. Sets differ by provider and cwd.

Open for Tool choices and Skill choices: Codex per-thread config needs a live check, and
Cursor's pinned SDK needs checking for `tools`.
