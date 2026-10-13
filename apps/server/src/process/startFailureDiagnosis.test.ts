import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import {
  checkStartFailureMemory,
  describeCause,
  diagnoseStartFailureMemory,
  formatStartFailureMemory,
  parseMemoryPressure,
  type ReadText,
  userFacingStartFailureMemory,
} from "./startFailureDiagnosis.ts";

const SELF = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.service\n";
const SLICE =
  "/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.slice/app-t3code-agents.slice";
const PRESSURE =
  "some avg10=1.50 avg60=0.80 avg300=0.20 total=12345\nfull avg10=0.40 avg60=0.10 avg300=0.00 total=999\n";

const fakeFiles =
  (files: Record<string, string>): ReadText =>
  (path) =>
    files[path];

const slice = (current: number, max: string, extra: Record<string, string> = {}) =>
  fakeFiles({
    "/proc/self/cgroup": SELF,
    [`${SLICE}/memory.current`]: String(current),
    [`${SLICE}/memory.max`]: `${max}\n`,
    ...extra,
  });

describe("diagnoseStartFailureMemory", () => {
  it("reports a slice over its limit with the user-facing message", () => {
    const diagnosis = diagnoseStartFailureMemory({ read: slice(9.8e9, "9400000000") });
    expect(formatStartFailureMemory(diagnosis)).toBe(
      "Couldn't start: the agent slice is over its memory limit (9.8 GB of 9.4 GB). Stop idle dev servers or teammates and retry.",
    );
  });

  it("reports a slice under its limit and names the pressure reading", () => {
    const diagnosis = diagnoseStartFailureMemory({
      read: slice(5e9, "9400000000", { "/proc/pressure/memory": PRESSURE }),
    });
    expect(diagnosis).toMatchObject({ kind: "slice", status: "within" });
    expect(formatStartFailureMemory(diagnosis)).toBe(
      "The agent slice is within its memory limit (5.0 GB of 9.4 GB); system memory pressure is 1.5% (some, 10 s average).",
    );
  });

  it("treats a slice close to its limit as at the limit", () => {
    const diagnosis = diagnoseStartFailureMemory({ read: slice(9.3e9, "9400000000") });
    expect(formatStartFailureMemory(diagnosis)).toContain("at its memory limit (9.3 GB of 9.4 GB)");
  });

  it("measures against memory.high, where the kernel starts throttling", () => {
    const diagnosis = diagnoseStartFailureMemory({
      read: slice(9.5e9, "11800000000", { [`${SLICE}/memory.high`]: "9400000000\n" }),
    });
    expect(diagnosis).toMatchObject({ kind: "slice", status: "over" });
    expect(formatStartFailureMemory(diagnosis)).toContain("(9.5 GB of 9.4 GB)");
  });

  it("handles a slice with no limit", () => {
    const diagnosis = diagnoseStartFailureMemory({ read: slice(2e9, "max") });
    expect(diagnosis).toMatchObject({ kind: "slice", status: "unlimited" });
  });

  it("says so when no slice is found", () => {
    const diagnosis = diagnoseStartFailureMemory({
      read: fakeFiles({ "/proc/self/cgroup": "0::/system.slice/foo.service\n" }),
    });
    expect(diagnosis).toEqual({ kind: "slice-not-found", pressure: undefined });
    expect(formatStartFailureMemory(diagnosis)).toBe(
      "Couldn't find the agent slice to check its memory.",
    );
  });

  it("copes with missing files", () => {
    const diagnosis = diagnoseStartFailureMemory({ read: fakeFiles({}) });
    expect(diagnosis).toEqual({ kind: "slice-not-found", pressure: undefined });
    const noMax = diagnoseStartFailureMemory({
      read: fakeFiles({ "/proc/self/cgroup": SELF, [`${SLICE}/memory.current`]: "100" }),
    });
    expect(noMax).toMatchObject({ kind: "slice", status: "unlimited" });
  });
});

describe("userFacingStartFailureMemory", () => {
  it("tells the user only when memory plausibly caused the failure", () => {
    const over = diagnoseStartFailureMemory({ read: slice(9.8e9, "9400000000") });
    expect(userFacingStartFailureMemory(over)).toContain("over its memory limit");
    const within = diagnoseStartFailureMemory({ read: slice(5e9, "9400000000") });
    expect(userFacingStartFailureMemory(within)).toBeUndefined();
    const missing = diagnoseStartFailureMemory({ read: fakeFiles({}) });
    expect(userFacingStartFailureMemory(missing)).toBeUndefined();
    expect(userFacingStartFailureMemory(undefined)).toBeUndefined();
  });
});

describe("parseMemoryPressure", () => {
  it("reads the some and full averages", () => {
    expect(parseMemoryPressure(PRESSURE)).toEqual({ someAvg10: 1.5, fullAvg10: 0.4 });
  });
  it("returns undefined for missing or malformed content", () => {
    expect(parseMemoryPressure(undefined)).toBeUndefined();
    expect(parseMemoryPressure("garbage")).toBeUndefined();
  });
});

describe("checkStartFailureMemory", () => {
  it.effect("skips quietly off Linux without reading anything", () =>
    Effect.gen(function* () {
      const reads: string[] = [];
      const result = yield* checkStartFailureMemory("darwin", (path) => {
        reads.push(path);
        return undefined;
      });
      expect(result).toBeUndefined();
      expect(reads).toEqual([]);
    }),
  );
});

describe("describeCause", () => {
  it("keeps message, code, stack and nested causes of every failure", () => {
    const inner = Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" });
    const outer = new Error("session failed to open", { cause: inner });
    const details = describeCause(Cause.combine(Cause.fail(outer), Cause.die("boom")));
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({
      message: "session failed to open",
      cause: { message: "spawn ENOMEM", code: "ENOMEM" },
    });
    expect(details[0]?.stack).toContain("session failed to open");
    expect(details[1]).toEqual({ message: "boom" });
  });

  it("survives a failure that cannot be serialized and names interrupts", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeCause(Cause.fail(circular))[0]?.message).toBe("[object Object]");
    expect(describeCause(Cause.interrupt())).toEqual([{ message: "Interrupted" }]);
  });
});
