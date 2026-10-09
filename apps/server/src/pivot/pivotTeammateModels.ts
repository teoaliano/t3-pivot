/**
 * The named teammate models from settings: which one a dispatch runs on, and
 * the list the Pivot reads in its home to choose one.
 */
import type { ModelSelection, TeammateModelEntry } from "@t3tools/contracts";

/** The entry marked default, else the first. */
export const defaultTeammateModel = (
  entries: ReadonlyArray<TeammateModelEntry>,
): TeammateModelEntry | null => entries.find((entry) => entry.isDefault) ?? entries[0] ?? null;

export type TeammateModelChoice =
  /** `modelSelection` null leaves the choice to the project and Pivot fallbacks. */
  | {
      readonly type: "chosen";
      readonly modelSelection: ModelSelection | null;
      readonly entry: string | null;
    }
  | { readonly type: "refused"; readonly reason: string };

/**
 * A model the Pivot names wins over an entry; a named entry must exist; with
 * neither, the default entry runs it.
 */
export const chooseTeammateModel = (
  entries: ReadonlyArray<TeammateModelEntry>,
  input: {
    readonly modelEntry?: string | undefined;
    readonly modelSelection?: ModelSelection | undefined;
  },
): TeammateModelChoice => {
  if (input.modelSelection !== undefined) {
    return { type: "chosen", modelSelection: input.modelSelection, entry: null };
  }
  if (input.modelEntry !== undefined) {
    const entry = entries.find((candidate) => candidate.name === input.modelEntry);
    if (entry === undefined) {
      return {
        type: "refused",
        reason:
          entries.length === 0
            ? `No teammate model is named "${input.modelEntry}": none are set up. Omit modelEntry.`
            : `No teammate model is named "${input.modelEntry}". Use one of: ${entries.map((candidate) => candidate.name).join(", ")}.`,
      };
    }
    return { type: "chosen", modelSelection: entry.modelSelection, entry: entry.name };
  }
  const fallback = defaultTeammateModel(entries);
  return {
    type: "chosen",
    modelSelection: fallback?.modelSelection ?? null,
    entry: fallback?.name ?? null,
  };
};

const describeModel = (selection: ModelSelection) => {
  const options = (selection.options ?? []).map((option) => `${option.id} ${String(option.value)}`);
  return `${selection.instanceId} / ${selection.model}${options.length > 0 ? `, ${options.join(", ")}` : ""}`;
};

/** The entries as the Pivot's contract lists them. */
export const renderTeammateModels = (entries: ReadonlyArray<TeammateModelEntry>): string => {
  if (entries.length === 0) {
    return "No teammate models are set up in Settings, so teammates run on the project's default model. Omit `modelEntry`.";
  }
  const fallback = defaultTeammateModel(entries);
  return entries
    .map(
      (entry) =>
        `- \`${entry.name}\`${entry === fallback ? " (default)" : ""}: ${describeModel(entry.modelSelection)}.${entry.description.length > 0 ? ` ${entry.description}` : ""}`,
    )
    .join("\n");
};
