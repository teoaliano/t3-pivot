import { EMPTY_PIVOT_STATE, type PivotState } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { useServerConfigs } from "./entities";
import { serverEnvironment } from "./server";

const NO_PIVOT_MODE = Atom.make(AsyncResult.success(EMPTY_PIVOT_STATE)).pipe(
  Atom.withLabel("web-pivot:none"),
);

/** Whether the environment's server runs Pivot mode. T3 Code servers do not. */
export function usePivotModeSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.pivotMode === true
  );
}

/**
 * Pivot mode's records for one environment, or null while they load. An
 * environment whose server does not run Pivot mode reads as having no Pivots.
 */
export function usePivotState(environmentId: EnvironmentId | null): PivotState | null {
  const supported = usePivotModeSupported(environmentId);
  const result = useAtomValue(
    supported && environmentId !== null
      ? serverEnvironment.pivotLive({ environmentId, input: {} })
      : NO_PIVOT_MODE,
  );
  return Option.getOrNull(AsyncResult.value(result));
}
