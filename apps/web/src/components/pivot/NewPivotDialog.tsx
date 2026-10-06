import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { takeoverSummary } from "@t3tools/client-runtime/pivot-state";
import {
  type EnvironmentId,
  type ProjectId,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { create } from "zustand";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProject } from "../../state/entities";
import { usePivotState } from "../../state/pivot";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { usePivotViewStore } from "./pivotViewStore";

/** The agents a Pivot runs on: the ones firstmate's contract is written for. */
const PIVOT_DRIVERS: ReadonlySet<string> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
  ProviderDriverKind.make("cursor"),
]);

interface NewPivotTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

const useNewPivotDialogStore = create<{
  readonly target: NewPivotTarget | null;
  readonly setTarget: (target: NewPivotTarget | null) => void;
}>()((set) => ({ target: null, setTarget: (target) => set({ target }) }));

/** Opens the New Pivot dialog for a project. Every entry point goes through here. */
export const openNewPivotDialog = (target: NewPivotTarget) =>
  useNewPivotDialogStore.getState().setTarget(target);

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

/** Mounted once; shows the dialog for whichever project asked. */
export function NewPivotDialogHost() {
  const target = useNewPivotDialogStore((state) => state.target);
  const setTarget = useNewPivotDialogStore((state) => state.setTarget);
  if (target === null) return null;
  return (
    <NewPivotDialog
      key={`${target.environmentId}:${target.projectId}`}
      target={target}
      onClose={() => setTarget(null)}
    />
  );
}

function NewPivotDialog(props: { target: NewPivotTarget; onClose: () => void }) {
  const { environmentId, projectId } = props.target;
  const navigate = useNavigate();
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const pivotState = usePivotState(environmentId);
  const takeover = pivotState === null ? null : takeoverSummary(pivotState, projectId);
  const readiness = usePivotProjectReadiness(environmentId, project?.workspaceRoot ?? null);
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ).filter((entry) => PIVOT_DRIVERS.has(entry.driverKind)),
    [providers, settings],
  );
  const fallback = scheduledTaskDefaultModel(settings, project, instanceEntries);
  const [selection, setSelection] = useState<{
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
  } | null>(null);
  const activeInstanceId =
    selection?.instanceId ??
    fallback?.instanceId ??
    instanceEntries[0]?.instanceId ??
    ("" as ProviderInstanceId);
  const activeModel = selection?.model ?? fallback?.model ?? "";
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers, activeInstanceId, activeModel),
    [settings, providers, activeInstanceId, activeModel],
  );
  const createPivot = useAtomCommand(serverEnvironment.createPivot, { reportFailure: false });
  const setMode = usePivotViewStore((state) => state.setMode);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (activeModel === "" || creating) return;
    setCreating(true);
    const result = await createPivot({
      environmentId,
      input: {
        projectId,
        modelSelection: { instanceId: activeInstanceId, model: activeModel },
        takeover: takeover !== null,
      },
    });
    setCreating(false);
    if (result._tag !== "Success") {
      const failure = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
      toastManager.add({
        type: "error",
        title: "The Pivot was not created.",
        ...(failure instanceof Error ? { description: failure.message } : {}),
      });
      return;
    }
    const ref = scopeThreadRef(environmentId, result.value.threadId);
    setMode(ref, "chat");
    props.onClose();
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New Pivot{project ? ` in ${project.title}` : ""}</DialogTitle>
          <DialogDescription>
            A Pivot takes your intent, dispatches teammates into their own worktrees, and brings
            back only outcomes and the calls that need you.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          {!readiness.ready ? (
            <p className="text-sm text-destructive-foreground" role="alert">
              {readiness.reason}
            </p>
          ) : null}
          {takeover !== null ? (
            <p className="text-sm" role="status">
              This takes over {takeover.liveTeammates} live{" "}
              {takeover.liveTeammates === 1 ? "teammate" : "teammates"} and {takeover.openDecisions}{" "}
              open {takeover.openDecisions === 1 ? "decision" : "decisions"} from the active Pivot,
              which stays as read-only history.
            </p>
          ) : null}
          <ProviderModelPicker
            disabled={creating}
            activeInstanceId={activeInstanceId}
            model={activeModel}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            isComposerOwned={false}
            onInstanceModelChange={(instanceId, model) => setSelection({ instanceId, model })}
          />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!readiness.ready || creating || activeModel === ""}
            onClick={() => void create()}
          >
            {takeover !== null ? "Take over" : "Create Pivot"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
