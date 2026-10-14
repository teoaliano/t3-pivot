import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Isolates long-lived agent and terminal processes from the server on Linux.
 *
 * Each wrapped command runs with a high `oom_score_adj`, so the kernel OOM
 * killer picks it before the server. Under a systemd user manager it also runs
 * in its own transient scope, so systemd-oomd (which kills whole leaf cgroups)
 * kills one agent instead of the server and every other agent.
 *
 * The server provides the real implementation. The default leaves commands
 * unchanged, which is also the behavior on macOS, Windows, and in tests.
 */
export interface AgentScopeShape {
  /**
   * Wraps the command that starts an agent or terminal. `name` labels the
   * scope unit, for example "claude" or "terminal". `env` is the environment
   * the command will run with, used to resolve it on PATH. A command that does
   * not resolve stays unwrapped, so a missing binary still fails at spawn.
   */
  readonly wrap: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly name: string;
    readonly threadId?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
  }) => Effect.Effect<AgentScopeCommand>;
  /**
   * Whether the latest agent scope of this thread was killed because the
   * machine or the agents slice ran out of memory. The answer holds until the
   * thread launches its next agent, so a retried failure reads the same.
   */
  readonly oomKilled: (threadId: string) => Effect.Effect<boolean>;
  /**
   * Forgets the thread's scope. The session manager calls it before it opens
   * a provider session, so a scope only answers for the session that launched
   * it, even when the next session runs without one (Cursor, OpenCode).
   */
  readonly clear: (threadId: string) => Effect.Effect<void>;
  /**
   * Stops every process still running in the thread's latest agent scope:
   * SIGTERM first, then SIGKILL for what survives the grace period.
   */
  readonly stop: (threadId: string) => Effect.Effect<void>;
  /**
   * One admission attempt for an agent about to start; it never waits. Agents start in
   * the order they asked, across every T3 server of this user. A ticket that is not
   * admitted stays in line only while its caller keeps asking: one that stops asking
   * (a stopped run, a dead server) drops out after a few missed polls. `spaced` marks a
   * Pivot teammate: those start only with memory to spare, one at a time, spaced out,
   * while other agents are held back only when memory is starved.
   */
  readonly admit: (input: {
    /** Stable across attempts for one start, such as the run id. */
    readonly ticketId: string;
    readonly threadId: string;
    readonly spaced: boolean;
  }) => Effect.Effect<AgentAdmission>;
  /** The machine's memory for agents now, or undefined where it is not measured. */
  readonly memory: () => Effect.Effect<MemoryProbe | undefined>;
  /** Threads whose agent is waiting in the admission queue. */
  readonly queuedThreadIds: () => Effect.Effect<ReadonlySet<string>>;
}

/**
 * admitted: start now. waiting: ask again shortly; `status` says why, for the user.
 * expired: it waited too long, and `message` is the failure to show.
 */
export type AgentAdmission =
  | { readonly _tag: "admitted" }
  | { readonly _tag: "waiting"; readonly status: string }
  | { readonly _tag: "expired"; readonly message: string };

/**
 * ok: a new agent starts now. tight: the slice is near its limit and the kernel
 * is starting to stall. starved: agents are throttled or stalling hard, so
 * another agent would make it worse.
 */
export type MemoryState = "ok" | "tight" | "starved";

export interface MemoryProbe {
  readonly state: MemoryState;
  /** `memory.current` of the agents slice, in bytes. */
  readonly currentBytes: number;
  /** `memory.high` of the agents slice, in bytes; undefined when unlimited. */
  readonly highBytes: number | undefined;
  /** The `some avg10` share of time stalled on memory, from the slice's memory.pressure. */
  readonly psiSomeAvg10: number;
}

/** A start that waited for memory longer than it may. */
export class AgentMemoryWaitError extends Schema.TaggedError<AgentMemoryWaitError>()(
  "AgentMemoryWaitError",
  { summary: Schema.String },
) {
  override get message() {
    return this.summary;
  }
}

/** A start held back for memory; whoever runs it asks again shortly instead of failing. */
export class AgentMemoryDeferral extends Schema.TaggedError<AgentMemoryDeferral>()(
  "AgentMemoryDeferral",
  { status: Schema.String },
) {
  override get message() {
    return this.status;
  }
}

export interface AgentScopeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export const AgentScope = Context.Reference<AgentScopeShape>("@t3tools/shared/AgentScope", {
  defaultValue: () => ({
    wrap: ({ command, args }) => Effect.succeed({ command, args }),
    oomKilled: () => Effect.succeed(false),
    clear: () => Effect.void,
    stop: () => Effect.void,
    admit: () => Effect.succeed({ _tag: "admitted" }),
    memory: () => Effect.succeed(undefined),
    queuedThreadIds: () => Effect.succeed(new Set<string>()),
  }),
});

/**
 * The thread an ACP runtime is spawned for. ACP runtimes are shared by several
 * provider flavors and do not take a thread id, so the ACP adapter provides it.
 */
export const AgentScopeThreadId = Context.Reference<string | undefined>(
  "@t3tools/shared/AgentScope/ThreadId",
  { defaultValue: () => undefined },
);

/**
 * Agents get this `oom_score_adj` so the kernel kills them before the server.
 * An unprivileged process may raise its own score, never lower it.
 */
export const AGENT_OOM_SCORE_ADJ = 800;

/** Shell line that raises the score of the current process, ignoring failure. */
export const RAISE_OOM_SCORE_LINE = `{ echo ${AGENT_OOM_SCORE_ADJ} >/proc/self/oom_score_adj; } 2>/dev/null`;

const LAUNCH_SCRIPT = [RAISE_OOM_SCORE_LINE, 'exec "$@"'].join("\n");

// systemd-run needs XDG_RUNTIME_DIR to reach the user manager. Fill it in when
// the agent environment does not carry it; it is the same user either way.
const SCOPED_LAUNCH_SCRIPT = [
  RAISE_OOM_SCORE_LINE,
  ': "${XDG_RUNTIME_DIR:=$1}"',
  "export XDG_RUNTIME_DIR",
  "shift",
  'exec "$@"',
].join("\n");

export interface AgentSystemdScope {
  readonly systemdRun: string;
  readonly slice: string;
  readonly unit: string;
  readonly runtimeDir: string;
  /** Extra `systemd-run` options, such as `--property=OOMPolicy=stop`. */
  readonly options: ReadonlyArray<string>;
}

/**
 * Builds the Linux launch for an agent command. Every step `exec`s, so the
 * spawned PID, stdio, and signals all belong to the agent itself.
 * `systemd-run --scope` registers its own PID as the scope and then runs the
 * command, so the agent and all of its children start inside the scope.
 */
export function agentScopeCommand(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly scope?: AgentSystemdScope | undefined;
}): AgentScopeCommand {
  const { command, args, scope } = input;
  if (scope === undefined) {
    return { command: "/bin/sh", args: ["-c", LAUNCH_SCRIPT, "t3-agent", command, ...args] };
  }
  return {
    command: "/bin/sh",
    args: [
      "-c",
      SCOPED_LAUNCH_SCRIPT,
      "t3-agent",
      scope.runtimeDir,
      scope.systemdRun,
      "--user",
      "--scope",
      "--quiet",
      `--slice=${scope.slice}`,
      `--unit=${scope.unit}`,
      ...scope.options,
      "--",
      command,
      ...args,
    ],
  };
}
