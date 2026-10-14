import type { PivotDecision } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  PaperclipIcon,
  ShieldIcon,
  SplitIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { ComposerImageAttachment } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "../chat/ComposerBanner";
import { ComposerImageThumbnail } from "../chat/ComposerImageThumbnail";
import { ComposerOptionRow } from "../chat/ComposerOptionRow";
import { messageActionPillClassName } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { recommendedOption, userAnswerLabel } from "./pivotDecisions.logic";
import { type PivotDecisionAttachments, pivotDecisionAnswerText } from "./pivotDecisionAttachments";

export interface PivotDecisionCardProps {
  decision: PivotDecision;
  /** Who is asking: the teammate's title, or the Pivot for its own decisions. */
  asker: string;
  /** Where this decision sits among those waiting for the user, when more than one is. */
  position: { readonly index: number; readonly total: number } | null;
  sending: boolean;
  /** Caps the question body so a short canvas keeps room for the timeline. */
  bodyMaxHeight?: string | undefined;
  /** Images for a question's answer. Absent where the server cannot take them. */
  attachments?: PivotDecisionAttachments | undefined;
  onAnswer: (text: string, approved?: boolean) => void;
}

/**
 * One decision the Pivot holds for the user, drawn like the composer's own pending
 * question: an attached banner over a second, minimal composer that takes the answer,
 * so the chat composer below stays free. Once answered it shrinks to one quiet row.
 */
export function PivotDecisionCard(props: PivotDecisionCardProps) {
  if (props.decision.userAnswer !== null) return <AnsweredDecision {...props} />;
  return <OpenDecision {...props} />;
}

/** Decisions the user minimized, remembered for the session; a new decision opens expanded. */
const minimizedDecisions = new Set<string>();

/**
 * An open decision, or the slim row it minimizes to. Minimizing neither answers nor
 * dismisses it, and the expanded box stays mounted underneath so a half-typed answer
 * survives.
 */
function OpenDecision(props: PivotDecisionCardProps) {
  const id = props.decision.decisionId;
  const [minimized, setMinimizedState] = useState(() => minimizedDecisions.has(id));
  const setMinimized = (next: boolean) => {
    if (next) minimizedDecisions.add(id);
    else minimizedDecisions.delete(id);
    setMinimizedState(next);
  };
  const approval = props.decision.escalation?.asksApproval === true;
  return (
    <>
      {minimized ? (
        <MinimizedDecision {...props} approval={approval} onExpand={() => setMinimized(false)} />
      ) : null}
      <div hidden={minimized}>
        {approval ? (
          <ApprovalDecision {...props} onMinimize={() => setMinimized(true)} />
        ) : (
          <QuestionDecision {...props} active={!minimized} onMinimize={() => setMinimized(true)} />
        )}
      </div>
    </>
  );
}

/** One row that still says a decision waits: its kind, the question, and where it sits. */
function MinimizedDecision({
  decision,
  asker,
  position,
  approval,
  onExpand,
}: PivotDecisionCardProps & { approval: boolean; onExpand: () => void }) {
  return (
    <ComposerBanner.Root placement="floating" className="mb-2" data-pivot-decision="minimized">
      <ComposerBanner.Row render={<button type="button" />} title="Expand" onClick={onExpand}>
        <ComposerBanner.Icon className={approval ? "text-warning" : undefined}>
          {approval ? <ShieldIcon /> : <SplitIcon />}
        </ComposerBanner.Icon>
        <ComposerBanner.Content>
          <span
            className={cn(
              "shrink-0 font-medium",
              approval ? "text-warning" : "text-muted-foreground",
            )}
          >
            {approval ? "Approval" : `${asker} asks`}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {questionsOf(decision).join(" ")}
          </span>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          {position !== null ? (
            <span className="text-3xs font-medium text-muted-foreground tabular-nums">
              {position.index + 1}/{position.total}
            </span>
          ) : null}
          <ComposerBanner.ToggleIcon expanded={false} />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  );
}

/** The expanded box's minimize control, in the banner's own icon-button style. */
function MinimizeButton(props: { onMinimize: () => void }) {
  return (
    <ComposerBanner.Dismiss aria-label="Minimize" title="Minimize" onClick={props.onMinimize}>
      <ChevronDownIcon className="size-3.5" />
    </ComposerBanner.Dismiss>
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
  attachments,
  onAnswer,
  active,
  onMinimize,
}: PivotDecisionCardProps & { active: boolean; onMinimize: () => void }) {
  const escalation = decision.escalation;
  const options = escalation?.options ?? [];
  const recommended =
    escalation === null ? null : recommendedOption(options, escalation.recommendation);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  // Typing an answer of their own replaces the picked option, as in the composer.
  const typed = text.trim().length > 0;
  const images = attachments?.images ?? [];
  const answer = pivotDecisionAnswerText({
    typed: typed ? text : null,
    selected,
    imageCount: images.length,
  });
  // An answer with images waits until they have all uploaded, so the Pivot gets every one.
  const imagesReady =
    (attachments?.preparing ?? 0) === 0 && (attachments?.blockReason ?? null) === null;
  const canSubmit = answer !== null && !sending && imagesReady;
  const submit = () => {
    if (answer === null || !canSubmit) return;
    onAnswer(answer);
  };
  const imageStatus =
    attachments === undefined
      ? null
      : attachments.preparing > 0
        ? "Preparing images…"
        : attachments.blockReason;

  // Number keys pick an option while focus is outside editable fields, like provider questions.
  useEffect(() => {
    if (!active || sending || options.length === 0) return;
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
  }, [active, sending, options]);

  return (
    <DecisionComposer
      data-pivot-decision="question"
      banner={
        <ComposerBanner.Root>
          <ComposerBanner.Row
            render={<button type="button" />}
            title="Minimize"
            onClick={onMinimize}
          >
            <ComposerBanner.Icon>
              <SplitIcon />
            </ComposerBanner.Icon>
            <ComposerBanner.Content>
              <span className="shrink-0 font-medium text-muted-foreground">{asker} asks</span>
            </ComposerBanner.Content>
            <ComposerBanner.Actions>
              {position !== null ? (
                <span className="text-3xs font-medium text-muted-foreground tabular-nums">
                  {position.index + 1}/{position.total}
                </span>
              ) : null}
              <ComposerBanner.ToggleIcon expanded />
            </ComposerBanner.Actions>
          </ComposerBanner.Row>
          <ComposerBanner.Scroll style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}>
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
                  {recommended === null ? <p>Recommended: {escalation.recommendation}</p> : null}
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
      leading={
        attachments === undefined ? null : (
          <AnswerImages images={images} status={imageStatus} onRemove={attachments.remove} />
        )
      }
      attach={
        attachments === undefined ? null : (
          <AttachImagesButton disabled={sending} onFiles={(files) => void attachments.add(files)} />
        )
      }
      onFiles={attachments === undefined ? undefined : (files) => void attachments.add(files)}
      action={
        <button
          type="button"
          className={cn(messageActionPillClassName, "h-8 px-4 sm:h-7")}
          disabled={!canSubmit}
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
  onMinimize,
}: PivotDecisionCardProps & { onMinimize: () => void }) {
  const escalation = decision.escalation;
  const [note, setNote] = useState("");
  const commented = note.trim().length > 0;
  // Accept works with or without a note; Comment needs one, since the note is what the
  // teammate receives.
  const accept = () => {
    if (sending) return;
    onAnswer(note.trim() || "Approved", true);
  };
  const comment = () => {
    if (sending || !commented) return;
    onAnswer(note.trim(), false);
  };
  return (
    <DecisionComposer
      data-pivot-decision="approval"
      banner={
        <ComposerBanner.Root density="spacious">
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
                {/* Scrolls inside itself like the composer's pending approval, so a long
                    evidence never pushes the banner past the top of a short pane. */}
                <span
                  aria-label="Approval request"
                  className="grid max-h-20 w-full min-w-0 gap-0.5 overflow-auto text-xs wrap-anywhere [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                  tabIndex={0}
                >
                  {questionsOf(decision).map((question) => (
                    <span key={question} className="text-foreground">
                      {question}
                    </span>
                  ))}
                  {escalation !== null ? (
                    <>
                      <span className="text-secondary-label">{escalation.evidence}</span>
                      <span className="text-secondary-label">{escalation.consequence}</span>
                      {escalation.mergeOrder !== undefined && escalation.mergeOrder.length > 0 ? (
                        <span className="text-secondary-label">
                          Merge order: {escalation.mergeOrder.join(" → ")}
                        </span>
                      ) : null}
                      <span className="text-secondary-label">
                        Recommended: {escalation.recommendation}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
            </ComposerBanner.Content>
            <ComposerBanner.Actions>
              <MinimizeButton onMinimize={onMinimize} />
              <Button
                size="xs"
                variant="outline"
                disabled={sending || !commented}
                onClick={comment}
              >
                Comment
              </Button>
              <Button size="xs" disabled={sending} onClick={accept}>
                Accept
              </Button>
            </ComposerBanner.Actions>
          </ComposerBanner.Row>
        </ComposerBanner.Root>
      }
      label="Anything to add"
      placeholder="Write a comment for the teammate, or accept above"
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
  /** Images above the editor, and the attach control beside it, when the answer takes images. */
  leading?: ReactNode;
  attach?: ReactNode;
  /** Receives images dropped on or pasted into the composer. */
  onFiles?: ((files: ReadonlyArray<File>) => void) | undefined;
  action: ReactNode;
}) {
  const { onSubmit, onFiles } = props;
  return (
    <ComposerSurface.Shell
      className="mb-2"
      data-pivot-decision={props["data-pivot-decision"]}
      onDragOver={
        onFiles === undefined
          ? undefined
          : (event) => {
              if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }
      }
      onDrop={
        onFiles === undefined
          ? undefined
          : (event) => {
              const files = Array.from(event.dataTransfer.files);
              if (files.length === 0) return;
              event.preventDefault();
              onFiles(files);
            }
      }
    >
      <ComposerBanner.Attachment>{props.banner}</ComposerBanner.Attachment>
      <ComposerSurface.Host>
        <ComposerSurface.Main>
          {props.leading}
          <div className="relative flex items-end gap-2 rounded-3xl px-3 py-2.5 sm:px-4">
            {props.attach}
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
              onPaste={
                onFiles === undefined
                  ? undefined
                  : (event) => {
                      const images = Array.from(event.clipboardData.files).filter((file) =>
                        file.type.startsWith("image/"),
                      );
                      if (images.length === 0) return;
                      event.preventDefault();
                      onFiles(images);
                    }
              }
              className="field-sizing-content max-h-40 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-0.5 font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) leading-relaxed text-foreground outline-none placeholder:text-placeholder/75 max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)"
            />
            {props.action}
          </div>
        </ComposerSurface.Main>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}

/** The images an answer carries, each removable until the answer is sent. */
function AnswerImages(props: {
  images: ReadonlyArray<ComposerImageAttachment>;
  status: string | null;
  onRemove: (imageId: string) => void;
}) {
  if (props.images.length === 0 && props.status === null) return null;
  return (
    <div className="grid gap-1.5 px-3 pt-2 sm:px-4">
      {props.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.images.map((image) => (
            <div
              key={image.id}
              className="relative size-14 overflow-hidden rounded-lg border bg-muted"
            >
              <ComposerImageThumbnail
                file={image.file}
                alt={image.name}
                className="size-full object-cover"
                fallback={
                  <span className="flex size-full items-center justify-center p-1 text-center text-3xs text-muted-foreground wrap-anywhere">
                    {image.name}
                  </span>
                }
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/85 text-foreground hover:bg-background"
                onClick={() => props.onRemove(image.id)}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {props.status !== null ? (
        <p className="text-xs text-secondary-label">{props.status}</p>
      ) : null}
    </div>
  );
}

/** The composer's attach control, for images picked from the file dialog. */
function AttachImagesButton(props: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          props.onFiles(files);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Attach images"
        className="shrink-0"
        disabled={props.disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <PaperclipIcon />
      </Button>
    </>
  );
}
