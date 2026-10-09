import type { PivotDecision } from "@t3tools/contracts";
import { CheckIcon, ShieldIcon, SplitIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { ComposerBanner } from "../chat/ComposerBanner";
import { ComposerOptionRow } from "../chat/ComposerOptionRow";
import { messageActionPillClassName } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { recommendedOption, userAnswerLabel } from "./pivotDecisions.logic";

export interface PivotDecisionCardProps {
  decision: PivotDecision;
  /** Who is asking: the teammate's title, or the Pivot for its own decisions. */
  asker: string;
  /** Where this decision sits among those waiting for the user, when more than one is. */
  position: { readonly index: number; readonly total: number } | null;
  sending: boolean;
  /** Caps the question body so a short canvas keeps room for the timeline. */
  bodyMaxHeight?: string | undefined;
  onAnswer: (text: string, approved?: boolean) => void;
}

/**
 * One decision the Pivot holds for the user, drawn like the composer's own pending
 * question: an attached banner over a second, minimal composer that takes the answer,
 * so the chat composer below stays free. Once answered it shrinks to one quiet row.
 */
export function PivotDecisionCard(props: PivotDecisionCardProps) {
  if (props.decision.userAnswer !== null) return <AnsweredDecision {...props} />;
  return props.decision.escalation?.asksApproval === true ? (
    <ApprovalDecision {...props} />
  ) : (
    <QuestionDecision {...props} />
  );
}

function questionsOf(decision: PivotDecision): ReadonlyArray<string> {
  return decision.escalation?.questions ?? [decision.summary];
}

function AnsweredDecision({ decision, asker }: PivotDecisionCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <ComposerBanner.Root placement="floating" className="mb-2" data-pivot-decision="answered">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={<ComposerBanner.Row render={<button type="button" />} />}
          title={open ? "Hide the question" : "Show the question"}
        >
          <ComposerBanner.Icon>
            <CheckIcon className="text-success" />
          </ComposerBanner.Icon>
          <ComposerBanner.Content>
            <span className="shrink-0 font-medium text-muted-foreground">
              {userAnswerLabel(decision.userApproved)}
            </span>
            <span className="min-w-0 truncate text-foreground">“{decision.userAnswer}”</span>
            <ComposerBanner.Separator />
            <span className="shrink-0 text-secondary-label">The Pivot is relaying it</span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.ToggleIcon expanded={open} />
          </ComposerBanner.Actions>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ComposerBanner.Body className="pe-1 pb-1 wrap-anywhere">
            {questionsOf(decision).map((question) => (
              <p key={question} className="text-sm text-foreground/85">
                {question}
              </p>
            ))}
            <p className="mt-1 text-secondary-label">Asked by {asker}</p>
          </ComposerBanner.Body>
        </CollapsiblePanel>
      </Collapsible>
    </ComposerBanner.Root>
  );
}

function QuestionDecision({
  decision,
  asker,
  position,
  sending,
  bodyMaxHeight,
  onAnswer,
}: PivotDecisionCardProps) {
  const escalation = decision.escalation;
  const options = escalation?.options ?? [];
  const recommended =
    escalation === null ? null : recommendedOption(options, escalation.recommendation);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  // Typing an answer of their own replaces the picked option, as in the composer.
  const typed = text.trim().length > 0;
  const answer = typed ? text : selected;
  const submit = () => {
    if (answer === null || sending) return;
    onAnswer(answer);
  };

  // Number keys pick an option while focus is outside editable fields, like provider questions.
  useEffect(() => {
    if (collapsed || sending || options.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      const option = Number.isNaN(digit) || digit < 1 ? undefined : options[digit - 1];
      if (option === undefined || digit > 9) return;
      event.preventDefault();
      setSelected(option);
      setText("");
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [collapsed, sending, options]);

  return (
    <DecisionComposer
      data-pivot-decision="question"
      banner={
        <ComposerBanner.Root>
          <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
            <CollapsibleTrigger
              render={<ComposerBanner.Row render={<button type="button" />} />}
              title={
                collapsed
                  ? "Show the question and its options"
                  : "Hide the question and its options"
              }
            >
              <ComposerBanner.Icon>
                <SplitIcon />
              </ComposerBanner.Icon>
              <ComposerBanner.Content>
                <span className="shrink-0 font-medium text-muted-foreground">{asker} asks</span>
                {collapsed ? (
                  <span className="min-w-0 flex-1 truncate text-secondary-label">
                    {questionsOf(decision).join(" ")}
                  </span>
                ) : null}
              </ComposerBanner.Content>
              <ComposerBanner.Actions>
                {position !== null ? (
                  <span className="text-3xs font-medium text-muted-foreground tabular-nums">
                    {position.index + 1}/{position.total}
                  </span>
                ) : null}
                <ComposerBanner.ToggleIcon expanded={!collapsed} />
              </ComposerBanner.Actions>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ComposerBanner.Scroll
                style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
              >
                <ComposerBanner.Body className="pe-1 pb-1 wrap-anywhere">
                  {questionsOf(decision).map((question) => (
                    <p key={question} className="text-sm text-foreground/85">
                      {question}
                    </p>
                  ))}
                  {escalation !== null ? (
                    <div className="mt-1 grid gap-0.5 text-secondary-label">
                      <p>{escalation.evidence}</p>
                      <p>{escalation.consequence}</p>
                      {recommended === null ? (
                        <p>Recommended: {escalation.recommendation}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {options.length > 0 ? (
                    <div className="mt-2 space-y-0.5">
                      {options.map((option, index) => (
                        <ComposerOptionRow
                          key={option}
                          label={option}
                          badge={
                            option === recommended ? (
                              <Badge size="sm" variant="info">
                                Recommended
                              </Badge>
                            ) : null
                          }
                          selected={!typed && selected === option}
                          shortcutKey={index < 9 ? index + 1 : null}
                          disabled={sending}
                          onSelect={() => {
                            setSelected(option);
                            setText("");
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </ComposerBanner.Body>
              </ComposerBanner.Scroll>
            </CollapsiblePanel>
          </Collapsible>
        </ComposerBanner.Root>
      }
      label="Your answer"
      placeholder={
        options.length > 0
          ? "Type your own answer, or pick an option above"
          : "Answer in your own words"
      }
      text={text}
      sending={sending}
      onTextChange={setText}
      onSubmit={submit}
      action={
        <button
          type="button"
          className={cn(messageActionPillClassName, "h-8 px-4 sm:h-7")}
          disabled={answer === null || sending}
          onClick={submit}
        >
          {sending ? "Submitting..." : "Submit answer"}
        </button>
      }
    />
  );
}

function ApprovalDecision({
  decision,
  asker,
  position,
  sending,
  onAnswer,
}: PivotDecisionCardProps) {
  const escalation = decision.escalation;
  const [note, setNote] = useState("");
  // A yes or no, recorded as such, with the user's own words when they add any.
  const respond = (approved: boolean) => {
    if (sending) return;
    onAnswer(note.trim() || (approved ? "Approved" : "Declined"), approved);
  };
  return (
    <DecisionComposer
      data-pivot-decision="approval"
      banner={
        <ComposerBanner.Root variant="warning" density="spacious">
          <ComposerBanner.Row layout="approval">
            <ComposerBanner.Icon>
              <ShieldIcon />
            </ComposerBanner.Icon>
            <ComposerBanner.Content>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
                  <span className="shrink-0 font-medium text-warning">Approval</span>
                  <span className="min-w-0 truncate">{asker}</span>
                  {position !== null ? (
                    <span className="ml-auto shrink-0 tabular-nums">
                      {position.index + 1}/{position.total}
                    </span>
                  ) : null}
                </span>
                <span className="grid gap-0.5 text-xs wrap-anywhere">
                  {questionsOf(decision).map((question) => (
                    <span key={question} className="text-foreground">
                      {question}
                    </span>
                  ))}
                  {escalation !== null ? (
                    <>
                      <span className="text-secondary-label">{escalation.evidence}</span>
                      <span className="text-secondary-label">{escalation.consequence}</span>
                      <span className="text-secondary-label">
                        Recommended: {escalation.recommendation}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
            </ComposerBanner.Content>
            <ComposerBanner.Actions>
              <Button size="xs" variant="outline" disabled={sending} onClick={() => respond(false)}>
                Decline
              </Button>
              <Button size="xs" disabled={sending} onClick={() => respond(true)}>
                Approve
              </Button>
            </ComposerBanner.Actions>
          </ComposerBanner.Row>
        </ComposerBanner.Root>
      }
      label="Anything to add"
      placeholder="Add a note (optional), then approve or decline above"
      text={note}
      sending={sending}
      onTextChange={setNote}
      onSubmit={null}
      action={null}
    />
  );
}

/**
 * A second composer for the decision's answer: the chat composer's surface and editor
 * type, without its footer controls. Enter submits when `onSubmit` is set; Shift+Enter
 * makes a newline.
 */
function DecisionComposer(props: {
  "data-pivot-decision": string;
  banner: ReactNode;
  label: string;
  placeholder: string;
  text: string;
  sending: boolean;
  onTextChange: (text: string) => void;
  onSubmit: (() => void) | null;
  action: ReactNode;
}) {
  const { onSubmit } = props;
  return (
    <ComposerSurface.Shell className="mb-2" data-pivot-decision={props["data-pivot-decision"]}>
      <ComposerBanner.Attachment>{props.banner}</ComposerBanner.Attachment>
      <ComposerSurface.Host>
        <ComposerSurface.Main>
          <div className="relative flex items-end gap-2 rounded-3xl px-3 py-2.5 sm:px-4">
            <textarea
              aria-label={props.label}
              placeholder={props.placeholder}
              value={props.text}
              disabled={props.sending}
              rows={1}
              onChange={(event) => props.onTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (onSubmit === null) return;
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                onSubmit();
              }}
              className="field-sizing-content max-h-40 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-0.5 font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) leading-relaxed text-foreground outline-none placeholder:text-placeholder/75 max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)"
            />
            {props.action}
          </div>
        </ComposerSurface.Main>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}
