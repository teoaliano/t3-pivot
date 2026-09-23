import type { ManagedProcess } from "@t3tools/contracts";

export interface ManagedProcessOverviewRow {
  readonly checkoutPath: string;
  /** The project's title for its main folder, with the branch for a worktree. */
  readonly checkoutLabel: string;
  readonly processes: ReadonlyArray<ManagedProcess>;
}

interface CheckoutNames {
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  readonly threads: ReadonlyArray<{
    readonly projectId: string;
    readonly worktreePath: string | null;
    readonly branch: string | null;
  }>;
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

function checkoutLabel(checkoutPath: string, names: CheckoutNames): string {
  const project = names.projects.find((candidate) => candidate.workspaceRoot === checkoutPath);
  if (project) return project.title;
  const thread = names.threads.find((candidate) => candidate.worktreePath === checkoutPath);
  const owner = thread && names.projects.find((candidate) => candidate.id === thread.projectId);
  const branch = thread?.branch ?? basename(checkoutPath);
  return owner ? `${owner.title} · ${branch}` : branch;
}

/** One row per checkout, in the order the server sorted the processes. */
export function managedProcessOverviewRows(
  processes: ReadonlyArray<ManagedProcess>,
  names: CheckoutNames,
): ReadonlyArray<ManagedProcessOverviewRow> {
  const byCheckout = new Map<string, ManagedProcess[]>();
  for (const process of processes) {
    const existing = byCheckout.get(process.checkoutPath);
    if (existing) existing.push(process);
    else byCheckout.set(process.checkoutPath, [process]);
  }
  return [...byCheckout].map(([checkoutPath, checkoutProcesses]) => ({
    checkoutPath,
    checkoutLabel: checkoutLabel(checkoutPath, names),
    processes: checkoutProcesses,
  }));
}
