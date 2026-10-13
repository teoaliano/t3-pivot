import type { EnvironmentId, PivotDecision, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { type DecisionOutcome, decisionLogEntry } from "./pivotDecisions.logic";

const OUTCOME_BADGE: Record<DecisionOutcome, "warning" | "info" | "success" | "secondary"> = {
  open: "warning",
  "pivot-answered": "info",
  "user-answered": "success",
  moot: "secondary",
  cleared: "secondary",
};

/**
 * Every decision the Pivot owns, newest first, so the user can audit the answers it gave
 * on its own. Fetched on demand; it refetches when the Pivot's decision counts move.
 */
export function PivotDecisionsPane(props: {
  environmentId: EnvironmentId;
  pivotThreadId: ThreadId;
  /** Changes whenever a decision opens, is escalated or closes. */
  changeKey: string;
  teammateTitle: (threadId: ThreadId) => string | null;
}) {
  const log = useEnvironmentQuery(
    serverEnvironment.pivotDecisionLog({
      environmentId: props.environmentId,
      input: { pivotThreadId: props.pivotThreadId },
    }),
  );
  const { refresh } = log;
  const seenKey = useRef(props.changeKey);
  useEffect(() => {
    if (seenKey.current === props.changeKey) return;
    seenKey.current = props.changeKey;
    refresh();
  }, [props.changeKey, refresh]);

  const decisions = log.data?.decisions ?? null;
  if (decisions === null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {log.error ?? (log.isPending ? "Loading decisions…" : null)}
      </p>
    );
  }
  if (decisions.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No decisions yet. Questions the Pivot answers or holds for you are listed here.
      </p>
    );
  }
  return (
    <ol className="flex size-full flex-col overflow-y-auto">
      {decisions.map((decision) => (
        <DecisionRow
          key={decision.decisionId}
          decision={decision}
          teammateTitle={
            decision.teammateThreadId === null
              ? null
              : props.teammateTitle(decision.teammateThreadId)
          }
        />
      ))}
    </ol>
  );
}

function DecisionRow(props: { decision: PivotDecision; teammateTitle: string | null }) {
  const entry = decisionLogEntry(props.decision);
  return (
    <li className="flex flex-col gap-1 border-b border-border px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Badge size="sm" variant={OUTCOME_BADGE[entry.outcome]}>
          {entry.label}
        </Badge>
        <span className="min-w-0 truncate">{props.teammateTitle ?? "The Pivot's own"}</span>
        <span className="ml-auto shrink-0">{formatRelativeTimeLabel(entry.at)}</span>
      </div>
      <p className="font-medium">{props.decision.summary}</p>
      {entry.text !== null ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{entry.text}</p>
      ) : null}
    </li>
  );
}
