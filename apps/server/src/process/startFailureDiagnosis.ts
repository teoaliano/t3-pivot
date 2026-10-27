// @effect-diagnostics nodeBuiltinImport:off -- cgroup and pressure files come from the host.
import * as NodeFS from "node:fs";

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

const CGROUP_ROOT = "/sys/fs/cgroup";
const AGENT_SLICE = "app-t3code-agents.slice";
const GB = 1000 ** 3;
// Within this share of the limit the kernel is already reclaiming or killing.
const NEAR_LIMIT_SHARE = 0.95;

export interface AgentSliceMemory {
  readonly currentBytes: number;
  /** `memory.high` when set, else `memory.max`; `undefined` when the slice has no limit. */
  readonly maxBytes: number | undefined;
}

export interface MemoryPressure {
  readonly someAvg10: number;
  readonly fullAvg10: number | undefined;
}

export type StartFailureMemoryDiagnosis =
  | { readonly kind: "slice-not-found"; readonly pressure: MemoryPressure | undefined }
  | {
      readonly kind: "slice";
      readonly memory: AgentSliceMemory;
      readonly status: "over" | "near" | "within" | "unlimited";
      readonly pressure: MemoryPressure | undefined;
    };

/** Reads a file's text, or `undefined` when it is missing or unreadable. */
export type ReadText = (path: string) => string | undefined;

export const readTextFromDisk: ReadText = (path) => {
  try {
    return NodeFS.readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** Parses /proc/pressure/memory: `some avg10=0.50 ...` and `full avg10=0.10 ...`. */
export function parseMemoryPressure(text: string | undefined): MemoryPressure | undefined {
  if (text === undefined) return undefined;
  const avg10 = (kind: "some" | "full") => {
    const match = new RegExp(`^${kind} .*?avg10=(\\d+(?:\\.\\d+)?)`, "m").exec(text);
    return match === null ? undefined : Number(match[1]);
  };
  const someAvg10 = avg10("some");
  return someAvg10 === undefined ? undefined : { someAvg10, fullAvg10: avg10("full") };
}

function parseBytes(text: string | undefined): number | undefined {
  const value = text?.trim();
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * Candidate cgroup directories for the agents slice, derived from the server's
 * own `/proc/self/cgroup` line (`0::/user.slice/.../app.slice/app-t3code.service`).
 */
function agentSliceDirs(selfCgroup: string | undefined): ReadonlyArray<string> {
  const path = selfCgroup === undefined ? undefined : /^0::(.*)$/m.exec(selfCgroup)?.[1]?.trim();
  if (path === undefined) return [];
  const appSliceEnd = path.indexOf("/app.slice");
  if (appSliceEnd < 0) return [];
  // systemd nests dashed slice names: app-t3code-agents.slice lives in app-t3code.slice.
  return [`${CGROUP_ROOT}${path.slice(0, appSliceEnd)}/app.slice/app-t3code.slice/${AGENT_SLICE}`];
}

/**
 * Reads the agents slice's memory use against its limit, plus system memory
 * pressure. Linux only: the caller skips this on other platforms.
 */
export function diagnoseStartFailureMemory(input: {
  readonly read: ReadText;
}): StartFailureMemoryDiagnosis {
  const pressure = parseMemoryPressure(input.read("/proc/pressure/memory"));
  for (const dir of agentSliceDirs(input.read("/proc/self/cgroup"))) {
    const currentBytes = parseBytes(input.read(`${dir}/memory.current`));
    if (currentBytes === undefined) continue;
    const maxBytes = parseBytes(input.read(`${dir}/memory.max`));
    const highBytes = parseBytes(input.read(`${dir}/memory.high`));
    // memory.max is enforced by reclaim and OOM kills, so use is rarely above it. Past
    // memory.high the kernel throttles every agent, which is what stalls a start.
    const limit = highBytes ?? maxBytes;
    const status =
      limit === undefined
        ? "unlimited"
        : currentBytes >= limit
          ? "over"
          : currentBytes >= limit * NEAR_LIMIT_SHARE
            ? "near"
            : "within";
    return {
      kind: "slice",
      memory: { currentBytes, maxBytes: limit },
      status,
      pressure,
    };
  }
  return { kind: "slice-not-found", pressure };
}

const formatGB = (bytes: number) => (bytes / GB).toFixed(1);

const formatPressure = (pressure: MemoryPressure | undefined) =>
  pressure === undefined
    ? undefined
    : `system memory pressure is ${pressure.someAvg10}% (some, 10 s average)`;

/**
 * The sentence for the error the user sees, only when memory plausibly caused the
 * failure. Every other reading goes to the log alone.
 */
export function userFacingStartFailureMemory(
  diagnosis: StartFailureMemoryDiagnosis | undefined,
): string | undefined {
  if (diagnosis?.kind !== "slice") return undefined;
  if (diagnosis.status !== "over" && diagnosis.status !== "near") return undefined;
  return formatStartFailureMemory(diagnosis);
}

/** The memory reading in words, for the log. */
export function formatStartFailureMemory(diagnosis: StartFailureMemoryDiagnosis): string {
  const pressure = formatPressure(diagnosis.pressure);
  if (diagnosis.kind === "slice-not-found") {
    return pressure === undefined
      ? "Couldn't find the agent slice to check its memory."
      : `Couldn't find the agent slice to check its memory; ${pressure}.`;
  }
  const { currentBytes, maxBytes } = diagnosis.memory;
  const used =
    maxBytes === undefined ? undefined : `${formatGB(currentBytes)} GB of ${formatGB(maxBytes)} GB`;
  const advice = "Stop idle dev servers or agents and retry.";
  switch (diagnosis.status) {
    case "over":
      return `Couldn't start: the agent slice is over its memory limit (${used}). ${advice}`;
    case "near":
      return `Couldn't start: the agent slice is at its memory limit (${used}). ${advice}`;
    case "within":
      return `The agent slice is within its memory limit (${used})${pressure === undefined ? "" : `; ${pressure}`}.`;
    case "unlimited":
      return `The agent slice has no memory limit (${formatGB(currentBytes)} GB in use)${pressure === undefined ? "" : `; ${pressure}`}.`;
  }
}

/** Skips quietly (`undefined`) off Linux. */
export const checkStartFailureMemory = Effect.fn("StartFailureDiagnosis.checkStartFailureMemory")(
  function* (read: ReadText = readTextFromDisk) {
    const platform = yield* HostProcess.Platform;
    return platform === "linux" ? diagnoseStartFailureMemory({ read }) : undefined;
  },
);

interface ErrorDetail {
  readonly name?: string;
  readonly message: string;
  readonly code?: unknown;
  readonly stack?: string;
  readonly cause?: ErrorDetail;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeError(error: unknown, depth = 0): ErrorDetail {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : safeStringify(error);
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    message,
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(typeof record.stack === "string" ? { stack: record.stack } : {}),
    ...(record.cause === undefined || depth >= 5
      ? {}
      : { cause: describeError(record.cause, depth + 1) }),
  };
}

/**
 * Every failure and defect in a cause with its message, code, stack and nested
 * causes, as plain data that a single log entry prints in full.
 */
export function describeCause(cause: Cause.Cause<unknown>): ReadonlyArray<ErrorDetail> {
  return cause.reasons.flatMap((reason) =>
    Cause.isFailReason(reason)
      ? [describeError(reason.error)]
      : Cause.isDieReason(reason)
        ? [describeError(reason.defect)]
        : [{ message: "Interrupted" }],
  );
}

/** The memory check a failed start runs; tests replace it with made-up readings. */
export const StartFailureMemoryCheck = Context.Reference<
  Effect.Effect<StartFailureMemoryDiagnosis | undefined>
>("t3/process/StartFailureMemoryCheck", { defaultValue: () => checkStartFailureMemory() });
