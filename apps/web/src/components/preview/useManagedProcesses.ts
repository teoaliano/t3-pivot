import type { EnvironmentId, ManagedProcess } from "@t3tools/contracts";

import { managedProcessEnvironment } from "~/state/managedProcesses";
import { useEnvironmentQuery } from "~/state/query";

const NO_PROCESSES: ReadonlyArray<ManagedProcess> = [];

/** The checkout's managed processes. Reading them holds no claim on them. */
export function useManagedProcesses(
  environmentId: EnvironmentId | null,
  checkoutPath: string | null,
): ReadonlyArray<ManagedProcess> {
  const query = useEnvironmentQuery(
    environmentId === null || checkoutPath === null
      ? null
      : managedProcessEnvironment.checkout({ environmentId, input: { checkoutPath } }),
  );
  return query.data?.processes ?? NO_PROCESSES;
}
