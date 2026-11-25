# Provider support for skills and tool limits

Answers `issues/02-provider-support-for-skills-and-tools.md`. Read-only research, 2026-11-02,
against this worktree (`t3/e7574f28`) plus provider docs. Paths are repo-relative; the
`node_modules` tree was not installed, so SDK option shapes come from the provider docs.

## Summary

| Provider | Skill subset per thread? | Built-in tool limits per thread? | User MCP servers include/exclude per thread? | What T3 does today |
| --- | --- | --- | --- | --- |
| Claude (Agent SDK 0.3.276) | **Yes, native**: `skills: [names] \| "all" \| []` query option | **Yes, native**: `tools` (availability list) + `disallowedTools` (incl. `mcp__server__*`) | **Yes**: `strictMcpConfig` + explicit `mcpServers`, or `disallowedTools: ["mcp__name__*"]` | Sets `tools` from runtime policy (read-only, file-scoped); PreToolUse hook for `withoutForgeMerge`; injects only `t3-code` server, user servers load untouched. Never passes `skills`. |
| Codex (app-server) | **Probably**: `thread/start.config` accepts config.toml keys; `skills.config[]` `{name\|path, enabled}` exists. Per-thread honoring of skills config is **unknown** | **Partly**: config keys `features.shell_tool`, `web_search`/`tools.web_search`, `features.view_image`. No apply_patch switch found | **Probably**: per-thread `config` with `mcp_servers.<id>.enabled` / `enabled_tools` / `disabled_tools` (unverified per thread) | Passes `config` per thread with only `tools.update_plan.enabled`, MCP grace, and `mcp_servers.t3-code`. Sandbox does the write scoping. |
| Cursor (`@cursor/sdk` 1.0.35) | **Not supported** (no documented skill allowlist); skills come with `settingSources` | **Yes per docs**: `tools` allowlist + `disallowedTools` (`"shell"`, `"mcp"`, `"task"`, ...). Presence in pinned 1.0.35 **unknown** | **Coarse**: drop `"project"`/`"user"`/`"plugins"` from `settingSources` to load only inline servers; no per-server exclude documented | Passes `settingSources: [project,user,team,mdm,plugins]`, sandbox on/off, inline `t3-code` server. |
| Grok (ACP, `grok agent stdio`) | **Unknown/not documented** | **Yes at spawn** (`--tools`, `--disallowed-tools`, `--allow/--deny` rules); T3 can also deny ACP permission requests, but only when Grok asks | **Unknown** (MCP managed via `grok mcp`; no per-session exclude documented) | Spawns with permission-mode argv only; answers ACP permission requests by kind/path. |
| OpenCode (v2 server) | **Yes, native**: session permission rules, `skill` action with name patterns (`deny` hides it) | **Yes, native**: session rules for `shell`, `edit`, `webfetch`, `websearch`, `task`, ...; last match wins | **Yes**: tool-name glob rules (T3 already denies `t3-code-*` then allows its own) | Writes per-session rules on create/update; already scopes T3 MCP per thread by rule. |
| Antigravity (ACP) | **Not supported** per thread; skills are per profile dir | **Not supported** (mode from runtime mode only) | **No user servers at all**: T3 runs it with a private `GEMINI_HOME` that isolates MCP | Links global skill dirs into the private profile; only T3's MCP server is given. |

T3 MCP tools are T3's own to scope and work the same for every provider: the server already
has a per-request visibility hook (`McpSchema.EnabledWhen`) and per-credential capabilities.

## Claude (Claude Code via Agent SDK)

**Skills discovery.** T3 mirrors Claude Code in `apps/server/src/provider/Drivers/ClaudeSkills.ts:431-538`:
`<config>/skills` (user, default `~/.claude`), `<cwd>/.claude/skills` (project), `--add-dir`
launch arg's `.claude/skills`, and enabled plugin skills from `<config>/plugins/installed_plugins.json`
(`discoverPluginSkillRoots`, :312). It applies `skillOverrides` (`on|name-only|user-invocable-only|off`)
from user, project, local and managed settings (:122-143, :208-285). Docs: skills load from
`settingSources`; defaults load user and project, plus parent dirs up to the repo root
(https://code.claude.com/docs/en/agent-sdk/skills).

**Skill subset.** Native. `skills` query option: list of exact names, `"all"`, or `[]`. Unlisted
skills are hidden from the model and the Skill tool rejects them, but files stay readable via
Read/Bash and `/<name>` dispatch still runs them. Plugin skills are named `plugin:skill`. If
`tools` is passed explicitly, `"Skill"` must be in it (docs above; option table at
https://code.claude.com/docs/en/agent-sdk/typescript). T3 does not pass `skills` today:
`makeClaudeQueryOptions` (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:1415-1553`)
has no such field. T3 does use the skill list for composer dispatch (`planClaudeSkillDispatch`, :1997-2003).

**Built-in tools.** Native and already used. `tools` controls availability; `allowedTools`
only pre-approves; `disallowedTools` bare name removes a tool, scoped rule denies matching
calls in every mode (TS reference above). T3 sets `tools` from runtime policy:
read-only sandbox gets `CLAUDE_READ_ONLY_ALLOWED_TOOLS`, file-scoped writes get read tools +
`Bash`/`TaskOutput`/`TaskStop` + `Agent` + `Edit`/`Write` with path rules (:2483-2560), else
the `claude_code` preset (:453, :1461). `withoutForgeMerge` is a `PreToolUse` hook on `Bash`
(:1532-1534, :1594-1618). Note the `tools` list must keep `Skill` if positions use skills.

**MCP servers.** T3 adds only `mcpServers["t3-code"]` and pre-approves `mcp__t3-code__*`
(or the read-only list) (`claudeMcpQueryOverrides`, :1642-1672). `settingSources` is never set
on the query, so user `~/.claude.json`, project `.mcp.json`, plugins and claude.ai connectors
all load. Per-thread exclusion options: `strictMcpConfig: true` with an explicit `mcpServers`
map ("ignore project `.mcp.json`, user settings, plugin-provided MCP servers, and claude.ai
connectors"), or `disallowedTools: ["mcp__<server>__*"]`. T3 already uses `--strict-mcp-config`
for text generation (`apps/server/src/textGeneration/ClaudeTextGeneration.ts:221`), and notes
`managed-mcp.json` forbids it (`apps/server/src/provider/Drivers/ClaudeHome.ts:45`).

## Codex (app-server)

**Skills discovery.** T3 asks the app-server: `skills/list { cwds: [cwd] }`
(`apps/server/src/provider/CodexProvider.ts:536-605`), returning name, path, scope, enabled,
description. Docs: `.agents/skills` from cwd up to repo root (REPO), `$HOME/.agents/skills`
(USER), `/etc/codex/skills` (ADMIN), bundled (SYSTEM) (https://learn.chatgpt.com/docs/build-skills).

**Skill subset.** No session allowlist documented. Disable via `[[skills.config]]` entries
`{ enabled = false, name | path }`, last match wins (same page;
https://learn.chatgpt.com/docs/config-file/config-reference). The app-server also exposes
`skills/config/write {enabled, name?, path?}` and `skills/extraRoots/set {extraRoots}`
(`packages/effect-codex-app-server/src/_generated/meta.gen.ts:35-36,63`; schema.gen.ts:54394-54421),
but those write global config / process-wide roots, not per thread. `thread/start` and
`thread/resume` accept `config: Record<string, Json>` (schema.gen.ts:56314-56330) and T3 already
uses it per thread (`CodexAdapterV2.ts:1298-1336`, called at :6591 and :6622). Whether a
`skills.config` array passed that way filters skills for that thread only: **unknown**, needs a
live test. Skill mentions are rewritten to `$name` (:419-424).

**Built-in tools.** Config keys, so also candidates for the per-thread `config` map:
`features.shell_tool` (command execution, on by default), `web_search` / `tools.web_search`,
`features.view_image`. No apply_patch switch found in the reference. Write scope today comes
from the sandbox (`docs/internals/pivot-mode.md:69-76`). `withoutForgeMerge` is not enforced
(pivot-mode.md:83-86).

**MCP servers.** `mcp_servers.<id>.enabled`, `enabled_tools`, `disabled_tools` (config reference).
T3 overrides only `mcp_servers.t3-code` "so launch-argument MCP servers survive" (:1325-1334);
user servers in `config.toml` load. Per-thread override of other servers' `enabled` via the same
`config` map is plausible but **unverified**.

## Cursor (`@cursor/sdk` 1.0.35)

**Skills discovery.** T3 scans without opening a session (`packages/provider-cursor/src/server/skills.ts:210-255`):
`.cursor/skills`, `.agents/skills`, `.codex/skills`, `.claude/skills` under cwd (project) and
home (user), plus `~/.cursor/skills-cursor` (system). Skill mentions rewritten to `/name` (:276-291).

**Skill subset.** **Not supported** as documented: skills load with the workspace scan and
`local.settingSources` (https://cursor.com/docs/sdk/typescript). No per-session allowlist found.

**Built-in tools.** Docs list `tools` (allowlist; `[]` = none) and `disallowedTools` (deny wins),
accepting names like `"read"`, `"task"`, groups `"shell"`, `"mcp"`; local-only, not persisted, so
re-pass on resume (same page). Whether 1.0.35 has them: **unknown**. T3 passes neither;
`makeCursorAgentOptions` sets `mode`, `autoReview`, `sandboxOptions.enabled`, `settingSources`
(`packages/provider-cursor/src/server/adapter.ts:295-330`).

**MCP servers.** Load order per docs: per-send, creation-time, plugins, `.cursor/mcp.json`
(project), `~/.cursor/mcp.json` (user); without `settingSources` only inline servers load.
That is all-or-nothing per layer, and dropping layers also drops their skills/rules.
Disallowing `"mcp"` removes all MCP tools including T3's. No per-server exclude documented.

## Grok (ACP)

**Skills discovery.** T3 runs `grok inspect --json` per cwd and reads its `skills` array
("honors ignored/disabled skills and nested plugin skills"), `packages/provider-grok/src/server/skills.ts:1,94-140`.
Third-party sources name `.grok/skills`, `~/.grok/skills`, plugin dirs, and `[skills]` paths in
`~/.grok/config.toml`; no official skills page found (https://docs.x.ai/build/features/skills 404).

**Skill subset.** **Unknown / not documented.**

**Built-in tools.** CLI flags `--tools <LIST>`, `--disallowed-tools <LIST>` ("Allow or remove
built-in tools"), `--allow`/`--deny <RULE>` (https://docs.x.ai/build/cli/reference). T3 spawns
`grok [--permission-mode X] agent [--always-approve] stdio` (`packages/provider-grok/src/server/acpSupport.ts:46-56`)
and could append these per session, list syntax **unknown**. T3 also answers ACP
`session/request_permission` by tool kind and path (`packages/provider-acp/src/server/clientPolicy.ts`;
Grok wrapper `adapter.ts:301-302`), but full-access teammates never ask (pivot-mode.md:84-86).

**MCP servers.** T3 passes only its own server in ACP `session/new.mcpServers`
(`packages/provider-acp/src/server/AcpSessionRuntime.ts:2112`). User servers come from Grok's
config (`grok mcp list|add|remove`); per-session exclusion **unknown**.

## OpenCode (v2 server)

**Skills discovery.** T3 calls `client.skill.list({ location })` on the running server
(`packages/provider-opencode/src/server/driver.ts:313,498-500`; adapter `v2/adapter.ts:3305-3315`).
Docs: `.opencode/skills`, `.claude/skills`, `.agents/skills` walking up to the git worktree, and
`~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` (https://opencode.ai/docs/skills/).

**Skill subset.** Native through permissions: `skill` permission with name patterns; `deny` hides
the skill from the agent and rejects access (same page). T3 already writes per-session rules
(`session.create({ permissions })` at `v2/adapter.ts:3380-3385`, `session.update` in `writeRules`
:2766-2775), so adding `skill` rules is the same channel. T3's rule vocabulary is the v2 schema
(`shell`, `edit`, `external_directory`; `sessionRules` :368-385), which differs from the v1 doc
names (`bash`); exact v2 action names for skills/web: **verify against `@opencode/schema`**.

**Built-in tools.** Same rules: last match wins, keys include `edit`, `bash`/`shell`, `task`,
`webfetch`, `websearch`, `skill`, `external_directory` (https://opencode.ai/docs/permissions/).

**MCP servers.** Tool-name glob rules already scope T3 MCP per thread: deny `t3-code-*`, allow
`<thisThreadServer>_*` (`v2/adapter.ts:356-366`). The same form can deny `<userServer>_*`.
T3 adds its server at runtime per thread (`prepareTurn`, :3004-3030).

## Antigravity (ACP)

**Skills discovery.** `apps/server/src/provider/Drivers/AntigravitySkills.ts:18-27,143-152`:
`<GEMINI_HOME>/config/skills`, `<GEMINI_HOME>/antigravity-cli/skills` (user), and
`.gemini/skills`, `.agents/skills`, `.agent/skills` under cwd (project). T3 runs Antigravity with a
private `GEMINI_HOME` per profile and symlinks the user's real `~/.gemini` skill dirs into it
(`apps/server/src/provider/antigravityAuthSupport.ts:222,233-262`).

**Skill subset.** **Not supported** per thread. The symlink mechanism shows a profile-wide way
to control which dirs it sees, but it is per profile, not per thread.

**Built-in tools.** **Not supported**: mode comes from runtime mode alone
(`AntigravityAdapterV2.ts:186`; pivot-mode.md:75, :133-135).

**MCP servers.** Private `GEMINI_HOME` "isolates credentials/hooks/MCP" (antigravityAuthSupport.ts:233),
so the user's `~/.gemini/config/mcp_config.json` servers are not loaded at all; only T3's server.

## T3's existing per-thread MCP scoping

- **One server, every tool registered for everyone.** `McpHttpServer.layer` merges all toolkits
  (`apps/server/src/mcp/McpHttpServer.ts:1074-1087`). Pivot/Teammate tools are visible to every
  caller; handlers check the caller is the Pivot or a teammate (:1060-1064).
- **Capabilities per credential.** `ProviderSessionManager.prepareMcpSession`
  (`apps/server/src/orchestration-v2/ProviderSessionManager.ts:415-480`) issues each thread a bearer
  credential with capabilities from `["preview","orchestration","worktree","device","pull-requests"]`
  (`McpInvocationContext.ts:15-21`). `preview`/`device` are added only when agent-access settings
  allow and `ThreadToolRestrictions.withoutBrowserOrDevice` is false. Handlers enforce with
  `requireMcpCapability` / `requireThreadMcpCapability` (call-time failure, not hidden).
- **Visibility hook exists.** Effect's `McpServer` filters `tools/list` per request through the
  tool's `McpSchema.EnabledWhen` annotation (`.repos/effect-smol/packages/effect/src/ai/McpServer.ts:404-416`).
  T3 reads its caller from the request fiber in `hiddenFromSubagents`
  (`McpInvocationContext.ts:56-64`), used today on two PR tools (`toolkits/pullRequests/tools.ts:327,341`).
  The same pattern could hide tools by position.
- **`ThreadToolRestrictions`** (`orchestration-v2/ThreadToolRestrictions.ts:14-29`) is a
  `Context.Reference` with two booleans, default unrestricted. `PivotToolRestrictions.ts:31-58`
  provides it: Pivot → no browser/device; teammate or anything under a teammate/Pivot →
  `withoutForgeMerge` (fed to `RuntimePolicy.ts:129-147`, enforced only by Claude).
  `ThreadWriteAccess` (:66-93) supplies write scopes.
- **Per-provider wiring of T3's server:** Claude `mcpServers["t3-code"]`; Codex `config["mcp_servers.t3-code"]`;
  Cursor inline `mcpServers`; ACP `session/new.mcpServers`; OpenCode per-thread server + rules.
- **User-connected MCP servers are not a T3 concept.** No MCP server list exists in
  `packages/contracts/src/settings.ts`; they live in each provider's native config. Including or
  excluding them is provider-by-provider (table above); T3 cannot enumerate them today.

## "Skills the environment can see"

Concretely: the union over enabled provider instances of `ServerProvider.skills` (machine-level)
and `ServerProvider.workspaceSnapshots[].skills` (per cwd), each a `ServerProviderSkill`
`{name, description?, path, scope?, enabled, displayName?, shortDescription?, userInvocationOnly?, userInvocable?}`
(`packages/contracts/src/server.ts:108-131,261-262`). Snapshots have a 5-minute TTL
(`PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS`, :133) and refresh via
`providerRegistry.refreshWorkspaceSnapshot({instanceId, cwd, fresh})` (`ProviderRegistry.ts:898`,
called from `ws.ts:2457`). Clients dedupe by name and filter invocable skills
(`packages/client-runtime/src/providerSkills.ts`). This is what the composer slash menu uses.

Cost per provider: Claude, Cursor, Antigravity are filesystem scans (cheap; Cursor has a
10k-entry / 8 MB budget). Codex needs an app-server request, Grok spawns `grok inspect --json`
(4 s timeout), OpenCode needs its server running. All already run for the composer, so a
Settings editor can read the cached snapshot rather than probe.

Facts that shape a Settings editor:
- Skill sets differ by provider: same `SKILL.md` can be visible to several (`.claude/skills` is read
  by Claude, Cursor, OpenCode; `.agents/skills` by Codex, Cursor, OpenCode, Antigravity), others are
  provider-only (`.cursor/skills`, `.opencode/skills`, `.gemini/skills`, Claude plugins).
- Project skills depend on cwd: a teammate's worktree can see project skills the machine-level
  list does not show.
- Names are the only common key; Claude plugin skills are `plugin:skill`.

## Open uncertainties

- Codex: does a `skills.config` array (or `features.shell_tool=false`, `mcp_servers.X.enabled=false`)
  in `thread/start.config` apply to that thread only? Needs a live app-server test.
- Cursor: are `tools` / `disallowedTools` present in `@cursor/sdk` 1.0.35, and is there any skill filter?
- Grok: list syntax for `--tools` / `--disallowed-tools`; any skill-disable or per-session MCP control.
- OpenCode v2: exact action names for skill and web rules in `@opencode/schema` (`skill`? `webfetch`?).
- Claude: `skills` restricts model invocation only; files stay readable and `/name` still dispatches.
  Interaction with T3's composer dispatch of an unlisted skill is untested.
- Claude: `strictMcpConfig` conflicts with an org `managed-mcp.json` (ClaudeHome.ts:45).
- Remote `PivotHost` environments see their own skills; whose list a position references is open
  (map.md "Not yet specified").
