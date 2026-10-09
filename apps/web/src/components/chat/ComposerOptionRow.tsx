import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * One choice in a question attached to the composer: a check once selected, otherwise
 * its 1–9 shortcut. Used by provider questions and by Pivot decisions.
 */
export function ComposerOptionRow(props: {
  label: string;
  description?: string | undefined;
  /** Shown after the label, such as a Recommended badge. */
  badge?: ReactNode;
  selected: boolean;
  shortcutKey: number | null;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { label, description, badge, selected, shortcutKey, disabled, onSelect } = props;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-primary/25",
        selected
          ? "bg-muted/55 text-foreground"
          : "bg-transparent text-foreground/85 hover:bg-muted/30",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {label}
          {badge}
        </span>
        {description && description !== label ? (
          <span className="text-secondary-label text-2xs">{description}</span>
        ) : null}
      </div>
      {selected ? (
        <CheckIcon className="size-3.5 shrink-0 text-primary" />
      ) : shortcutKey !== null ? (
        <kbd className="flex size-5 shrink-0 items-center justify-center text-3xs font-medium text-muted-foreground tabular-nums">
          {shortcutKey}
        </kbd>
      ) : null}
    </button>
  );
}
