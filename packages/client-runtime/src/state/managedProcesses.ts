import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Keeps a checkout's stream open briefly after the last reader goes, so tab switches do not resubscribe. */
const MANAGED_PROCESSES_IDLE_TTL_MS = 10_000;

export function createManagedProcessEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** A checkout's managed processes, stopped ones included. Watching holds no claim. */
    checkout: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:managed-processes:checkout",
      tag: WS_METHODS.subscribeManagedProcesses,
      idleTtlMs: MANAGED_PROCESSES_IDLE_TTL_MS,
    }),
    /** Every live or pinned process across the environment's checkouts. Holds no claim. */
    overview: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:managed-processes:overview",
      tag: WS_METHODS.subscribeManagedProcessOverview,
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:managed-processes:start",
      tag: WS_METHODS.managedProcessStart,
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:managed-processes:stop",
      tag: WS_METHODS.managedProcessStop,
    }),
    setPinned: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:managed-processes:set-pinned",
      tag: WS_METHODS.managedProcessSetPinned,
    }),
  };
}
