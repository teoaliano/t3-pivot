import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { takeoverSummary } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { create } from "zustand";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProject, waitForThreadShell } from "../../state/entities";
import { usePivotState } from "../../state/pivot";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { readLocalApi } from "../../localApi";
import { toastManager } from "../ui/toast";
import { decideNewPivot, replacePivotPrompt } from "./newPivot.logic";
import { pivotDefaultModel } from "./pivotModel.logic";
import { usePivotViewStore } from "./pivotViewStore";

interface NewPivotTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

const useNewPivotStore = create<{
  readonly target: NewPivotTarget | null;
  readonly setTarget: (target: NewPivotTarget | null) => void;
}>()((set) => ({ target: null, setTarget: (target) => set({ target }) }));

/**
 * Creates a Pivot in a project on its Pivot model from Settings, then opens it,
 * asking first when it would replace the project's unsettled Pivot. Every entry
 * point goes through here; a creation already under way wins.
 */
export const startNewPivot = (target: NewPivotTarget) => {
  const store = useNewPivotStore.getState();
  if (store.target === null) store.setTarget(target);
};

/** Whether Pivot mode can run in a checkout: teammates need git worktrees. */
export function usePivotProjectReadiness(
  environmentId: EnvironmentId | null,
  workspaceRoot: string | null,
): { readonly ready: boolean; readonly reason: string | null } {
  const status = useEnvironmentQuery(
    environmentId === null || workspaceRoot === null
      ? null
      : vcsEnvironment.status({ environmentId, input: { cwd: workspaceRoot } }),
  );
  if (status.data !== null && status.data.isRepo === false) {
    return {
      ready: false,
      reason: "Pivot mode needs a git repository: every teammate works in its own worktree.",
    };
  }
  return { ready: true, reason: null };
}

/** Mounted once; creates the Pivot whichever entry point asked for. */
export function NewPivotHost() {
  const target = useNewPivotStore((state) => state.target);
  const setTarget = useNewPivotStore((state) => state.setTarget);
  if (target === null) return null;
  return (
    <NewPivotCreation
      key={`${target.environmentId}:${target.projectId}`}
      target={target}
      onDone={() => setTarget(null)}
    />
  );
}

function NewPivotCreation(props: { target: NewPivotTarget; onDone: () => void }) {
  const { environmentId, projectId } = props.target;
  const navigate = useNavigate();
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const pivotState = usePivotState(environmentId);
  const takeover = pivotState === null ? null : takeoverSummary(pivotState, projectId);
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const modelSelection = pivotDefaultModel(
    settings,
    project,
    sortProviderInstanceEntries(
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
    ),
  );
  const createPivot = useAtomCommand(serverEnvironment.createPivot, { reportFailure: false });
  const setMode = usePivotViewStore((state) => state.setMode);
  // Runs once per request, including under StrictMode's double effects, and
  // only once the project's Pivots have loaded so a replacement is never missed.
  const started = useRef(false);

  useEffect(() => {
    if (started.current || pivotState === null) return;
    started.current = true;
    void (async () => {
      const decision = await decideNewPivot(
        takeover,
        async () =>
          (await readLocalApi()?.dialogs.confirm(
            replacePivotPrompt(project?.title ?? "this project", takeover!),
          )) ?? false,
      );
      if (decision === "cancel") return props.onDone();
      if (modelSelection === null) {
        toastManager.add({
          type: "error",
          title: "The Pivot was not created.",
          description: "No provider can run a Pivot. Set a Pivot model in Settings.",
        });
        return props.onDone();
      }
      const result = await createPivot({
        environmentId,
        input: { projectId, modelSelection, takeover: decision === "replace" },
      });
      if (result._tag !== "Success") {
        const failure = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
        toastManager.add({
          type: "error",
          title: "The Pivot was not created.",
          ...(failure instanceof Error ? { description: failure.message } : {}),
        });
        return props.onDone();
      }
      const ref = scopeThreadRef(environmentId, result.value.threadId);
      // The route treats a thread missing from the shell as gone and redirects
      // home, so land only once the new Pivot has reached this client.
      const arrived = await waitForThreadShell(ref);
      props.onDone();
      if (!arrived) {
        toastManager.add({
          type: "error",
          title: "The Pivot was created, but has not reached this client yet.",
          description: "Reconnect and open it from the sidebar.",
        });
        return;
      }
      if (takeover !== null) {
        toastManager.add({
          type: "info",
          title: `Took over ${takeover.liveTeammates} live ${takeover.liveTeammates === 1 ? "teammate" : "teammates"} and ${takeover.openDecisions} open ${takeover.openDecisions === 1 ? "decision" : "decisions"}.`,
          description: "The previous Pivot stays as read-only history.",
        });
      }
      setMode(ref, "chat");
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    })();
  });

  return null;
}
