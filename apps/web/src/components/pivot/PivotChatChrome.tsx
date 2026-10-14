import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { decisionsHeldBy } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, PivotDecision, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { LayoutDashboardIcon } from "lucide-react";
import { useState } from "react";

import { shortcutLabelForCommand } from "../../keybindings";
import { useServerConfigs } from "../../state/entities";
import { usePivotState } from "../../state/pivot";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useChatCanvas } from "../chat/ChatCanvasContext";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  clearPivotDecisionAttachments,
  readyPivotDecisionImages,
  usePivotDecisionAttachments,
} from "./pivotDecisionAttachments";
import { PivotDecisionCard } from "./PivotDecisionCard";
import { useInPivotView } from "./pivotViewContext";
import { otherPivotViewMode, usePivotViewMode, usePivotViewStore } from "./pivotViewStore";

/** What a thread is in Pivot mode, for the chat around it. */
export type PivotChatRole =
  | { readonly kind: "none" }
  | { readonly kind: "pivot"; readonly retired: false }
  | { readonly kind: "pivot"; readonly retired: true; readonly successorThreadId: ThreadId | null }
  | { readonly kind: "teammate"; readonly pivotThreadId: ThreadId };

export function usePivotChatRole(environmentId: EnvironmentId, threadId: ThreadId): PivotChatRole {
  const state = usePivotState(environmentId);
  const pivot = state?.pivots[threadId];
  if (pivot !== undefined) {
    return pivot.retiredAt === null
      ? { kind: "pivot", retired: false }
      : { kind: "pivot", retired: true, successorThreadId: pivot.successorThreadId };
  }
  const teammate = state?.teammates[threadId];
  if (teammate !== undefined) return { kind: "teammate", pivotThreadId: teammate.pivotThreadId };
  return { kind: "none" };
}

/** The header button that flips a Pivot between its chat and its Pivot view. Nothing for other threads. */
export function PivotViewSwitch(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  /** Show it inside the Pivot view too; its top bar passes this. */
  force?: boolean;
}) {
  const inPivotView = useInPivotView();
  const role = usePivotChatRole(props.environmentId, props.threadId);
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const mode = usePivotViewMode(ref);
  const setMode = usePivotViewStore((state) => state.setMode);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (role.kind !== "pivot" || (inPivotView && props.force !== true)) return null;
  const next = otherPivotViewMode(mode);
  const shortcut = shortcutLabelForCommand(keybindings, "pivot.toggleView");
  const hint = next === "pivot" ? "Switch to Pivot view" : "Switch to chat";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            aria-label="Pivot view"
            variant="ghost"
            size="sm"
            pressed={mode === "pivot"}
            onPressedChange={() => setMode(ref, next)}
          />
        }
      >
        <LayoutDashboardIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {shortcut === null ? hint : `${hint} (${shortcut})`}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Stands in for the composer on a retired Pivot, which is read-only history. */
export function PivotComposerBar(props: {
  environmentId: EnvironmentId;
  successorThreadId: ThreadId | null;
}) {
  const navigate = useNavigate();
  const successor = props.successorThreadId;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>This Pivot is retired. Its live work moved to the Pivot that took over.</span>
      {successor !== null ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(props.environmentId, successor)),
            })
          }
        >
          Open the active Pivot
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The decisions a Pivot holds for the user, above its composer until answered. Answered
 * ones wait as quiet rows while the Pivot relays them; the oldest open one takes the
 * answer. The answer is recorded in the user's exact words and goes to the Pivot.
 */
export function PivotDecisionsStrip(props: {
  environmentId: EnvironmentId;
  pivotThreadId: ThreadId;
}) {
  const state = usePivotState(props.environmentId);
  // A short Pivot view pane still needs room for the timeline and composer around the card.
  const canvasHeight = useChatCanvas()?.container.height ?? 0;
  const decisions = state === null ? [] : decisionsHeldBy(state, props.pivotThreadId);
  if (decisions.length === 0) return null;
  const answered = decisions.filter((decision) => decision.userAnswer !== null);
  const waiting = decisions.filter((decision) => decision.userAnswer === null);
  const current = waiting[0];
  const askerOf = (decision: PivotDecision) =>
    (decision.teammateThreadId === null
      ? null
      : state?.teammates[decision.teammateThreadId]?.title) ?? "The Pivot";
  return (
    <div data-pivot-decisions-strip="true">
      {answered.map((decision) => (
        <PivotDecisionCard
          key={decision.decisionId}
          decision={decision}
          asker={askerOf(decision)}
          position={null}
          sending={false}
          onAnswer={() => {}}
        />
      ))}
      {current !== undefined ? (
        <OpenPivotDecision
          key={current.decisionId}
          environmentId={props.environmentId}
          decision={current}
          asker={askerOf(current)}
          position={waiting.length > 1 ? { index: 0, total: waiting.length } : null}
          canvasHeight={canvasHeight}
        />
      ) : null}
    </div>
  );
}

function OpenPivotDecision(props: {
  environmentId: EnvironmentId;
  decision: PivotDecision;
  asker: string;
  position: { index: number; total: number } | null;
  canvasHeight: number;
}) {
  const [sending, setSending] = useState(false);
  const answerDecision = useAtomCommand(serverEnvironment.answerPivotDecision, {
    reportFailure: false,
  });
  const supportsImages =
    useServerConfigs().get(props.environmentId)?.environment.capabilities
      .pivotDecisionAttachments === true;
  const attachments = usePivotDecisionAttachments({
    environmentId: props.environmentId,
    decisionId: props.decision.decisionId,
  });
  const submit = async (text: string, approved?: boolean) => {
    if (text.trim().length === 0 || sending) return;
    const images = readyPivotDecisionImages(props.environmentId, props.decision.decisionId);
    if (images === null) {
      toastManager.add({
        type: "error",
        title: "Wait for the images to finish uploading, or remove the failed ones.",
      });
      return;
    }
    setSending(true);
    const result = await answerDecision({
      environmentId: props.environmentId,
      input: {
        decisionId: props.decision.decisionId,
        answer: text,
        ...(approved === undefined ? {} : { approved }),
        ...(images.length === 0 ? {} : { attachments: images }),
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Your answer was not recorded." });
      return;
    }
    clearPivotDecisionAttachments(props.environmentId, props.decision.decisionId);
  };
  return (
    <PivotDecisionCard
      decision={props.decision}
      asker={props.asker}
      position={props.position}
      sending={sending}
      canvasHeight={props.canvasHeight}
      attachments={supportsImages ? attachments : undefined}
      onAnswer={(text, approved) => void submit(text, approved)}
    />
  );
}
