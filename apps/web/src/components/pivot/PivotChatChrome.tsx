import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { decisionsHeldBy } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, PivotDecision, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayoutDashboardIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { usePivotState } from "../../state/pivot";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useChatCanvas } from "../chat/ChatCanvasContext";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PivotDecisionCard } from "./PivotDecisionCard";
import { useInPivotView } from "./pivotViewContext";
import { usePivotViewMode, usePivotViewStore } from "./pivotViewStore";

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

/** The header switch between a Pivot's chat and its Pivot view. Nothing for other threads. */
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
  if (role.kind !== "pivot" || (inPivotView && props.force !== true)) return null;
  return (
    <ToggleGroup
      aria-label="Show this Pivot as"
      className="shrink-0"
      variant="segmented"
      value={[mode]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "chat" || next === "pivot") setMode(ref, next);
      }}
    >
      <Toggle aria-label="Chat" value="chat">
        <MessageSquareIcon className="size-3.5" />
        Chat
      </Toggle>
      <Toggle aria-label="Pivot view" value="pivot">
        <LayoutDashboardIcon className="size-3.5" />
        Pivot
      </Toggle>
    </ToggleGroup>
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
          bodyMaxHeight={
            canvasHeight > 0
              ? `min(14rem, ${Math.round(Math.max(120, canvasHeight * 0.3))}px)`
              : undefined
          }
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
  bodyMaxHeight: string | undefined;
}) {
  const [sending, setSending] = useState(false);
  const answerDecision = useAtomCommand(serverEnvironment.answerPivotDecision, {
    reportFailure: false,
  });
  const submit = async (text: string, approved?: boolean) => {
    if (text.trim().length === 0 || sending) return;
    setSending(true);
    const result = await answerDecision({
      environmentId: props.environmentId,
      input: {
        decisionId: props.decision.decisionId,
        answer: text,
        ...(approved === undefined ? {} : { approved }),
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Your answer was not recorded." });
    }
  };
  return (
    <PivotDecisionCard
      decision={props.decision}
      asker={props.asker}
      position={props.position}
      sending={sending}
      bodyMaxHeight={props.bodyMaxHeight}
      onAnswer={(text, approved) => void submit(text, approved)}
    />
  );
}
