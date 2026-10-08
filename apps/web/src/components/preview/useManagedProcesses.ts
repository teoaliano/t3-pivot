import type { EnvironmentId, ManagedProcessCheckoutSnapshot } from "@t3tools/contracts";

import { managedProcessEnvironment } from "~/state/managedProcesses";
import { useEnvironmentQuery } from "~/state/query";

const EMPTY: Pick<ManagedProcessCheckoutSnapshot, "processes" | "detectedScript"> = {
  processes: [],
  detectedScript: null,
};

/**
 * The checkout's managed processes and the package.json dev script it offers.
 * Reading them holds no claim on them.
 */
export function useManagedProcesses(
  environmentId: EnvironmentId | null,
  checkoutPath: string | null,
): Pick<ManagedProcessCheckoutSnapshot, "processes" | "detectedScript"> {
  const query = useEnvironmentQuery(
    environmentId === null || checkoutPath === null
      ? null
      : managedProcessEnvironment.checkout({ environmentId, input: { checkoutPath } }),
  );
  return query.data ?? EMPTY;
}
