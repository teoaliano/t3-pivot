import { EMPTY_PIVOT_STATE, type PivotState } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { useServerConfigs } from "./entities";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

const NO_PIVOT_MODE = Atom.make<PivotState | null>(EMPTY_PIVOT_STATE).pipe(
  Atom.withLabel("web-pivot:none"),
);

/**
 * Pivot mode's records for one environment, or null while they load. An environment
 * whose server does not run Pivot mode reads as having no Pivots.
 */
export const pivotStateAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): PivotState | null => {
    const supported =
      get(environmentPresentations.serverConfigsAtom).get(environmentId)?.environment.capabilities
        .pivotMode === true;
    if (!supported) return EMPTY_PIVOT_STATE;
    return Option.getOrNull(
      AsyncResult.value(get(serverEnvironment.pivotLive({ environmentId, input: {} }))),
    );
  }).pipe(Atom.withLabel(`web-pivot:${environmentId}`)),
);

/** Whether the environment's server runs Pivot mode. T3 Code servers do not. */
export function usePivotModeSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.pivotMode === true
  );
}

/** The connected environments whose servers run Pivot mode. */
export function usePivotModeEnvironmentIds(): ReadonlySet<EnvironmentId> {
  const configs = useServerConfigs();
  return new Set(
    [...configs]
      .filter(([, config]) => config.environment.capabilities.pivotMode === true)
      .map(([environmentId]) => environmentId),
  );
}

/** The hook form of `pivotStateAtom`; no environment reads as having no Pivots. */
export function usePivotState(environmentId: EnvironmentId | null): PivotState | null {
  return useAtomValue(environmentId === null ? NO_PIVOT_MODE : pivotStateAtom(environmentId));
}
