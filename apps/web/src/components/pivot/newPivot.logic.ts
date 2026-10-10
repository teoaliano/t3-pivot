import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

const sameRef = (left: ScopedProjectRef, right: ScopedProjectRef) =>
  left.environmentId === right.environmentId && left.projectId === right.projectId;

/**
 * Where picking a project in "New Pivot in..." lands: the copy the user is in
 * when it belongs to the picked project, else the picker's own copy, else any
 * copy on an environment that runs Pivot mode. Null hides the project.
 */
export function resolveNewPivotProjectRef(input: {
  readonly targetRef: ScopedProjectRef;
  readonly memberRefs: readonly ScopedProjectRef[];
  readonly contextualRef: ScopedProjectRef | null;
  readonly supportsPivot: (environmentId: EnvironmentId) => boolean;
}): ScopedProjectRef | null {
  const candidates = [
    ...(input.contextualRef !== null &&
    input.memberRefs.some((ref) => sameRef(ref, input.contextualRef!))
      ? [input.contextualRef]
      : []),
    input.targetRef,
    ...input.memberRefs,
  ];
  return candidates.find((ref) => input.supportsPivot(ref.environmentId)) ?? null;
}

export interface NewPivotTakeover {
  readonly liveTeammates: number;
  readonly openDecisions: number;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The question asked before a new Pivot replaces a project's unsettled one. */
export function replacePivotPrompt(projectTitle: string, takeover: NewPivotTakeover): string {
  return [
    `Replace the Pivot in ${projectTitle}?`,
    `The new Pivot inherits its ${plural(takeover.liveTeammates, "live teammate")} and ${plural(takeover.openDecisions, "open decision")}. The current Pivot retires and stays as read-only history.`,
  ].join("\n");
}

/**
 * Whether to create a Pivot, and as a takeover: a project whose Pivot is not
 * settled asks first, and declining creates nothing.
 */
export async function decideNewPivot(
  takeover: NewPivotTakeover | null,
  confirmReplace: () => Promise<boolean>,
): Promise<"create" | "replace" | "cancel"> {
  if (takeover === null) return "create";
  return (await confirmReplace()) ? "replace" : "cancel";
}
