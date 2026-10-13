// @effect-diagnostics nodeBuiltinImport:off -- the process table is the host's /proc.
import * as NodeFSP from "node:fs/promises";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

/** One process, as the host's process table shows it. */
export interface HostProcess {
  readonly pid: number;
  readonly ppid: number;
  /** The command line, arguments joined by spaces. */
  readonly command: string;
  /** The first argument, which names the program. */
  readonly program: string;
  readonly cwd: string | null;
  /** The `t3code-*.scope` unit the process runs in, if any. */
  readonly unit: string | null;
}

/** What the reaper needs from the host; tests pass a fake one. */
export interface ReaperHost {
  readonly snapshot: Effect.Effect<ReadonlyArray<HostProcess>>;
  readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void>;
}

export const STOP_GRACE = Duration.seconds(5);
const POLL = Duration.millis(100);
const CLAUDE_SCOPE = /^t3code-claude-.+\.scope$/;

export const isClaudeScope = (unit: string) => CLAUDE_SCOPE.test(unit);

/** The agent itself (or its launcher), as opposed to what it started. */
const isClaude = (process: HostProcess) =>
  /(^|\/)(claude|systemd-run)$/.test(process.program) || // systemd-run is claude still starting
  (/(^|\/)node$/.test(process.program) && /(^|\/)claude(\.js)?(\s|$)/.test(process.command));

const describe = (process: HostProcess) => ({
  pid: process.pid,
  command: process.command.slice(0, 200),
});

/**
 * Stops the processes: SIGTERM, up to `grace` for them to leave, then SIGKILL for
 * any still alive. Each one is logged with its pid and command.
 */
export const stopProcesses = (
  host: ReaperHost,
  targets: ReadonlyArray<HostProcess>,
  reason: string,
  grace: Duration.Duration = STOP_GRACE,
) =>
  Effect.gen(function* () {
    if (targets.length === 0) return;
    const pids = new Set(targets.map((process) => process.pid));
    for (const process of targets) {
      yield* Effect.logInfo("Stopping process", {
        reason,
        signal: "SIGTERM",
        ...describe(process),
      });
      yield* host.signal(process.pid, "SIGTERM");
    }
    const survivors = host.snapshot.pipe(
      Effect.map((table) => table.filter((process) => pids.has(process.pid))),
    );
    const deadline = Duration.toMillis(grace);
    let waited = 0;
    let alive = yield* survivors;
    while (alive.length > 0 && waited < deadline) {
      yield* Effect.sleep(POLL);
      waited += Duration.toMillis(POLL);
      alive = yield* survivors;
    }
    for (const process of alive) {
      yield* Effect.logWarning("Stopping process", {
        reason,
        signal: "SIGKILL",
        ...describe(process),
      });
      yield* host.signal(process.pid, "SIGKILL");
    }
  });

/** Stops everything running in one scope. */
export const stopScope = (host: ReaperHost, unit: string, reason: string) =>
  Effect.gen(function* () {
    const table = yield* host.snapshot;
    yield* stopProcesses(
      host,
      table.filter((process) => process.unit === unit),
      reason,
    );
  });

/**
 * Stops what is left in every `t3code-claude-*.scope` whose `claude` process is
 * gone. A scope with a live `claude` is left alone.
 */
export const sweepOrphanScopes = (host: ReaperHost) =>
  Effect.gen(function* () {
    const table = yield* host.snapshot;
    const byUnit = new Map<string, Array<HostProcess>>();
    for (const process of table) {
      if (process.unit === null || !isClaudeScope(process.unit)) continue;
      byUnit.set(process.unit, [...(byUnit.get(process.unit) ?? []), process]);
    }
    for (const [unit, members] of byUnit) {
      if (members.some(isClaude)) continue;
      yield* Effect.logWarning("Agent scope outlived its claude process", { unit });
      yield* stopProcesses(host, members, `orphaned scope ${unit}`);
    }
  });

const inside = (cwd: string, root: string) =>
  cwd === root || cwd.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Stops every process whose working directory is inside the worktree: terminals,
 * dev servers and anything they started there. The server `self` and its ancestors
 * are never stopped.
 */
export const stopWorktreeProcesses = (host: ReaperHost, worktreePath: string, self: number) =>
  Effect.gen(function* () {
    const table = yield* host.snapshot;
    const keep = serverLineage(table, self);
    const targets = table.filter(
      (process) =>
        !keep.has(process.pid) && process.cwd !== null && inside(process.cwd, worktreePath),
    );
    yield* stopProcesses(host, targets, `worktree ${worktreePath}`);
  });

const readProcess = async (pid: number): Promise<HostProcess | null> => {
  try {
    const dir = `/proc/${pid}`;
    const [cmdline, stat, cgroup, cwd] = await Promise.all([
      NodeFSP.readFile(`${dir}/cmdline`, "utf8"),
      NodeFSP.readFile(`${dir}/stat`, "utf8"),
      NodeFSP.readFile(`${dir}/cgroup`, "utf8"),
      NodeFSP.readlink(`${dir}/cwd`).catch(() => null),
    ]);
    const args = cmdline.split("\0").filter((part) => part.length > 0);
    if (args.length === 0) return null; // kernel threads and zombies
    // Fields after the last ")" start with the state, then the parent pid.
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const leaf = cgroup.trim().split("\n").at(-1)?.split("/").at(-1) ?? "";
    return {
      pid,
      ppid: Number.isFinite(ppid) ? ppid : 0,
      command: args.join(" "),
      program: args[0]!,
      cwd,
      unit: leaf.startsWith("t3code-") && leaf.endsWith(".scope") ? leaf : null,
    };
  } catch {
    return null; // the process left while we read it
  }
};

/** Linux only: the table is /proc and signals go through process.kill. */
export const procHost: ReaperHost = {
  snapshot: Effect.promise(async () => {
    const entries = await NodeFSP.readdir("/proc").catch(() => []);
    const read = await Promise.all(
      entries.filter((entry) => /^\d+$/.test(entry)).map((entry) => readProcess(Number(entry))),
    );
    return read.filter((process): process is HostProcess => process !== null);
  }),
  signal: (pid, signal) =>
    Effect.sync(() => {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }),
};

/** The server's own pid and its ancestors: never stopped by a worktree teardown. */
export const serverLineage = (table: ReadonlyArray<HostProcess>, self: number) => {
  const parents = new Map(table.map((process) => [process.pid, process.ppid]));
  const lineage = new Set<number>();
  for (let pid: number | undefined = self; pid !== undefined && pid > 1 && !lineage.has(pid);) {
    lineage.add(pid);
    pid = parents.get(pid);
  }
  return lineage;
};
