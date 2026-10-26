import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { CheckboxMark } from "../ui/checkbox";
import { Kbd } from "../ui/kbd";

/**
 * One choice in a question attached to the composer: a radio, or a checkbox when more
 * than one can be picked, and its 1–9 shortcut. Used by provider questions and by Pivot decisions.
 */
export function ComposerOptionRow(props: {
  label: string;
  description?: string | undefined;
  /** Shown after the label, such as a Recommended badge. */
  badge?: ReactNode;
  selected: boolean;
  multiSelect?: boolean | undefined;
  shortcutKey: number | null;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { label, description, badge, selected, multiSelect, shortcutKey, disabled, onSelect } =
    props;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-md bg-transparent py-1.5 ps-2 text-left sm:ps-1.5 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
        selected ? "text-foreground" : "text-foreground/70 hover:bg-muted/30",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      {/* The h-5 slots match the label's line box, so the indicator and shortcut stay on its first line. */}
      <span className="pointer-events-none flex h-5 shrink-0 items-center">
        {multiSelect ? <CheckboxMark checked={selected} /> : <OptionRadio checked={selected} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {label}
          {badge}
        </span>
        {description && description !== label ? (
          <span className="text-secondary-label text-2xs">{description}</span>
        ) : null}
      </div>
      {shortcutKey !== null ? (
        <span className="flex h-5 w-7 shrink-0 items-center justify-center sm:w-6">
          <Kbd>{shortcutKey}</Kbd>
        </span>
      ) : null}
    </button>
  );
}

// Drawn with ui/radio-group's look instead of using its Radio: Radio only checks inside a
// RadioGroup, whose arrow keys select options and would trip the single-select auto-advance.
function OptionRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding sm:size-4 dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="-inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-2 before:rounded-full before:bg-primary-foreground sm:before:size-1.5" />
      ) : null}
    </span>
  );
}
