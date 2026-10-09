import { createManagedProcessEnvironmentAtoms } from "@t3tools/client-runtime/state/managed-processes";

import { connectionAtomRuntime } from "../connection/runtime";

export const managedProcessEnvironment =
  createManagedProcessEnvironmentAtoms(connectionAtomRuntime);
