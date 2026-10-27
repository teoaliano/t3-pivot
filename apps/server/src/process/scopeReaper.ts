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
  /** Clock ticks since boot when it started; with the pid, names one process for good. */
  readonly startTime: number;
}

/** What the reaper needs from the host; tests pass a fake one. */
export interface ReaperHost {
  readonly snapshot: Effect.Effect<ReadonlyArray<HostProcess>>;
  readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void>;
}

export const STOP_GRACE = Duration.seconds(5);
const POLL = Duration.millis(100);

/**
 * Whether the unit is one of this server's scopes. Units carry the owner tag
 * (`t3code-<name>-<owner>-<id>.scope`), so a server never touches the scopes of
 * another T3 server running as the same user. An empty owner matches nothing.
 */
export const ownsUnit = (owner: string, unit: string, name = "[a-z]+") =>
  /^[0-9a-f]+$/.test(owner) && new RegExp(`^t3code-${name}-${owner}-[0-9a-f]+\\.scope$`).test(unit);

const describe = (process: HostProcess) => ({
  pid: process.pid,
  command: process.command.slice(0, 200),
});

/**
 * Stops the processes: SIGTERM, up to `grace` for them to leave, then SIGKILL for
 * any still alive. Each one is logged with its pid and command.
 */
export const stopProcesses = Effect.fn("ScopeReaper.stopProcesses")(function* (
  host: ReaperHost,
  targets: ReadonlyArray<HostProcess>,
  reason: string,
  grace: Duration.Duration = STOP_GRACE,
) {
  if (targets.length === 0) return;
  // A pid is only reused after its process is gone, so the start time tells them apart.
  const identity = (process: HostProcess) => `${process.pid}:${process.startTime}`;
  const ids = new Set(targets.map(identity));
  for (const process of targets) {
    yield* Effect.logInfo("Stopping process", {
      reason,
      signal: "SIGTERM",
      ...describe(process),
    });
    yield* host.signal(process.pid, "SIGTERM");
  }
  const survivors = host.snapshot.pipe(
    Effect.map((table) => table.filter((process) => ids.has(identity(process)))),
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
export const stopScope = Effect.fn("ScopeReaper.stopScope")(function* (
  host: ReaperHost,
  unit: string,
  reason: string,
) {
  const table = yield* host.snapshot;
  yield* stopProcesses(
    host,
    table.filter((process) => process.unit === unit),
    reason,
  );
});

/**
 * Stops what is left in every claude scope of this server whose agent is gone.
 * The server spawns each agent itself, so a scope whose agent still runs holds a
 * child of `self`. When the agent exits, what it started is reparented away from
 * the server; a scope left by an earlier run of this server has no child of it at all.
 */
export const sweepOrphanScopes = Effect.fn("ScopeReaper.sweepOrphanScopes")(function* (
  host: ReaperHost,
  owner: string,
  self: number,
) {
  const table = yield* host.snapshot;
  const byUnit = new Map<string, Array<HostProcess>>();
  for (const process of table) {
    if (process.unit === null || !ownsUnit(owner, process.unit, "claude")) continue;
    byUnit.set(process.unit, [...(byUnit.get(process.unit) ?? []), process]);
  }
  for (const [unit, members] of byUnit) {
    if (members.some((process) => process.ppid === self)) continue;
    yield* Effect.logWarning("Agent scope outlived its claude process", { unit });
    yield* stopProcesses(host, members, `orphaned scope ${unit}`);
  }
});

const inside = (cwd: string, root: string) =>
  cwd === root || cwd.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Stops the processes this server's agent and terminal scopes run inside the
 * worktree: terminals, dev servers and anything they started there. A process
 * outside this server's scopes is never touched, whatever its working directory,
 * so a user's own shell or editor in the worktree survives. The server `self` and
 * its ancestors are never stopped.
 */
export const stopWorktreeProcesses = Effect.fn("ScopeReaper.stopWorktreeProcesses")(function* (
  host: ReaperHost,
  input: { readonly worktreePath: string; readonly owner: string; readonly self: number },
) {
  const { worktreePath, owner, self } = input;
  if (!worktreePath.startsWith("/") || worktreePath.replace(/\/+$/, "") === "") return;
  const table = yield* host.snapshot;
  const keep = serverLineage(table, self);
  const targets = table.filter(
    (process) =>
      !keep.has(process.pid) &&
      process.unit !== null &&
      ownsUnit(owner, process.unit) &&
      process.cwd !== null &&
      inside(process.cwd, worktreePath),
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
    // Fields after the last ")" start with the state (field 3), then the parent pid;
    // the start time is field 22.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(fields[1]);
    const startTime = Number(fields[19]);
    const leaf = cgroup.trim().split("\n").at(-1)?.split("/").at(-1) ?? "";
    return {
      pid,
      ppid: Number.isFinite(ppid) ? ppid : 0,
      command: args.join(" "),
      program: args[0]!,
      cwd,
      unit: leaf.startsWith("t3code-") && leaf.endsWith(".scope") ? leaf : null,
      startTime: Number.isFinite(startTime) ? startTime : 0,
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
