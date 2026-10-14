import type { PivotDecision } from "@t3tools/contracts";
import { useCallback, useEffect } from "react";

import { DraftId, useComposerDraftStore, useComposerThreadDraft } from "~/composerDraftStore";

/**
 * Where a decision's typed answer lives in the composer draft store, so it survives
 * switching threads like the chat composer's draft. Keyed per Pivot thread and decision.
 * No `:` in the key: it would parse as an environment-scoped thread key on hydrate.
 */
export function pivotDecisionDraftTarget(decision: PivotDecision): DraftId {
  return DraftId.make(`pivot-decision/${decision.pivotThreadId}/${decision.decisionId}`);
}

/** The decision's answer text, as the draft store holds it. */
export function usePivotDecisionDraft(decision: PivotDecision) {
  const target = pivotDecisionDraftTarget(decision);
  const text = useComposerThreadDraft(target).prompt;
  const setText = useCallback(
    (next: string) => useComposerDraftStore.getState().setPrompt(target, next),
    [target],
  );
  return [text, setText] as const;
}

/**
 * Drops a decision's draft once it closes, whether the user answered it or it resolved
 * elsewhere. Open decisions keep theirs.
 */
export function discardClosedDecisionDraft(decision: PivotDecision): void {
  if (decision.userAnswer === null && decision.resolution === null) return;
  useComposerDraftStore.getState().clearComposerContent(pivotDecisionDraftTarget(decision));
}

/**
 * Mounted by the card itself, not the open composer, which unmounts once the decision
 * is answered.
 */
export function useDiscardClosedDecisionDraft(decision: PivotDecision): void {
  useEffect(() => discardClosedDecisionDraft(decision), [decision]);
}
