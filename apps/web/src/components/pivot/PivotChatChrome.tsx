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
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
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

/**
 * Stands in for the composer where Pivot mode takes typing away: a retired
 * Pivot is read-only history, and a teammate in the Pivot view is steered
 * through its Pivot.
 */
export function PivotComposerBar(props: { environmentId: EnvironmentId; role: PivotChatRole }) {
  const navigate = useNavigate();
  const { role } = props;
  if (role.kind === "pivot" && role.retired) {
    const successor = role.successorThreadId;
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
  return (
    <div className="px-4 py-3 text-sm text-muted-foreground">
      Read-only here: steer this teammate through the Pivot, or open it from the sidebar to type to
      it directly.
    </div>
  );
}

/**
 * The decisions a Pivot holds for the user, above its composer until answered.
 * The answer is recorded in the user's exact words and goes to the Pivot.
 */
export function PivotDecisionsStrip(props: {
  environmentId: EnvironmentId;
  pivotThreadId: ThreadId;
}) {
  const state = usePivotState(props.environmentId);
  const decisions = state === null ? [] : decisionsHeldBy(state, props.pivotThreadId);
  if (decisions.length === 0) return null;
  return (
    <div
      data-pivot-decisions-strip="true"
      className="mb-2 flex max-h-72 flex-col gap-2 overflow-y-auto rounded-xl border border-warning/32 bg-warning-surface p-2"
    >
      {decisions.map((decision) => (
        <PivotDecisionCard
          key={decision.decisionId}
          environmentId={props.environmentId}
          decision={decision}
        />
      ))}
    </div>
  );
}

function PivotDecisionCard(props: { environmentId: EnvironmentId; decision: PivotDecision }) {
  const { decision } = props;
  const escalation = decision.escalation;
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const answerDecision = useAtomCommand(serverEnvironment.answerPivotDecision, {
    reportFailure: false,
  });
  const submit = async (text: string) => {
    if (text.trim().length === 0 || sending) return;
    setSending(true);
    const result = await answerDecision({
      environmentId: props.environmentId,
      input: { decisionId: decision.decisionId, answer: text },
    });
    setSending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Your answer was not recorded." });
      return;
    }
    setAnswer("");
  };

  if (decision.userAnswer !== null) {
    return (
      <div className="rounded-lg bg-background/60 px-3 py-2 text-sm">
        <div className="font-medium">{escalation?.questions.join(" ") ?? decision.summary}</div>
        <div className="mt-1 text-muted-foreground">
          You answered: “{decision.userAnswer}”. The Pivot is relaying it.
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-background/60 px-3 py-2 text-sm">
      <div className="font-medium">
        {escalation?.questions.map((question) => <p key={question}>{question}</p>) ??
          decision.summary}
      </div>
      {escalation !== null ? (
        <dl className="grid gap-1 text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">Evidence: </dt>
            <dd className="inline">{escalation.evidence}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Consequence: </dt>
            <dd className="inline">{escalation.consequence}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Recommended: </dt>
            <dd className="inline">{escalation.recommendation}</dd>
          </div>
        </dl>
      ) : null}
      {escalation !== null && escalation.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {escalation.options.map((option) => (
            <Button
              key={option}
              size="xs"
              variant={answer === option ? "default" : "outline"}
              onClick={() => setAnswer(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Your answer"
          placeholder="Answer in your own words"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit(answer);
            }
          }}
        />
        <Button
          size="sm"
          disabled={answer.trim().length === 0 || sending}
          onClick={() => void submit(answer)}
        >
          Answer
        </Button>
      </div>
    </div>
  );
}
