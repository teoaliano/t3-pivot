/**
 * The texts the server writes into teammate threads: the brief a teammate
 * starts from, and the superseding contract a promoted scout receives. Pure:
 * templates come in, text goes out.
 */
import type { PivotDeliveryMode, TeammateKind } from "@t3tools/contracts";

/** Names of the `text/*.md` files these renderers read. */
export const BRIEF_TEXTS = {
  brief: "teammate-brief",
  promotion: "promotion",
  scout: "definition-of-done.scout",
  shipPr: "definition-of-done.ship-pr",
  shipLocal: "definition-of-done.ship-local",
} as const;

export const definitionOfDoneText = (kind: TeammateKind, deliveryMode: PivotDeliveryMode) =>
  kind === "scout"
    ? BRIEF_TEXTS.scout
    : deliveryMode === "direct-pr"
      ? BRIEF_TEXTS.shipPr
      : BRIEF_TEXTS.shipLocal;

/** Drops the leading `<!-- ... -->` note a template carries for maintainers. */
const stripTemplateNote = (template: string) => template.replace(/^\s*<!--[\s\S]*?-->\s*/, "");

/**
 * Fills `{{name}}` placeholders. Values are inserted once, never re-scanned, so a
 * user's intent that happens to contain `{{spec}}` stays as written.
 */
const fill = (template: string, values: Readonly<Record<string, string>>) =>
  stripTemplateNote(template).replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : match,
  );

export interface BriefValues {
  readonly title: string;
  readonly kind: TeammateKind;
  readonly intent: string;
  readonly spec: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  /** The rendered definition-of-done text for the kind and delivery mode. */
  readonly definitionOfDone: string;
}

export const renderBrief = (template: string, values: BriefValues) =>
  fill(template, {
    title: values.title,
    kind: values.kind,
    intent: values.intent.trim(),
    spec: values.spec.trim(),
    branch: values.branch,
    baseBranch: values.baseBranch,
    worktreePath: values.worktreePath,
    definitionOfDone: stripTemplateNote(values.definitionOfDone),
  });

export const renderPromotion = (
  template: string,
  values: { readonly intent: string; readonly spec: string; readonly definitionOfDone: string },
) =>
  fill(template, {
    intent: values.intent.trim(),
    spec: values.spec.trim(),
    definitionOfDone: stripTemplateNote(values.definitionOfDone),
  });

// The user's words go in verbatim; a label in front of them ("User: ...") turns
// them into a transcript line and blurs who said what.
const SPEAKER_LABEL =
  /^\s*(?:the\s+)?(?:user|human|captain|client|customer|assistant|ai|pivot|system|me|i)\s*(?:says|said|wrote|asked|asks)?\s*[:：]/i;

export const opensWithSpeakerLabel = (intent: string) => SPEAKER_LABEL.test(intent);

/** `pivot/<slug of the title>`, before any suffix that keeps it unique. */
export const teammateBranchBase = (title: string) => {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `pivot/${slug.length > 0 ? slug : "task"}`;
};

/** The first of `base`, `base-2`, `base-3`, ... that `taken` does not hold. */
export const uniqueBranch = (base: string, taken: (branch: string) => boolean) => {
  if (!taken(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken(candidate)) return candidate;
  }
};
