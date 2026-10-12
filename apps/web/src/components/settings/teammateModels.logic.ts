import type { ModelSelection, TeammateModelEntry } from "@t3tools/contracts";

/** The entry a Pivot uses when it names none: the one marked, else the first. */
export function defaultTeammateModelIndex(entries: readonly TeammateModelEntry[]): number {
  const marked = entries.findIndex((entry) => entry.isDefault);
  return marked === -1 ? 0 : marked;
}

/** A name the Pivot can pass back: lowercase letters, digits and dashes. */
export function teammateModelSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base.slice(0, 40 - String(suffix).length - 1)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addTeammateModel(
  entries: readonly TeammateModelEntry[],
  modelSelection: ModelSelection,
): TeammateModelEntry[] {
  const name = uniqueName("model", new Set(entries.map((entry) => entry.name)));
  return [...entries, { name, modelSelection, description: "", isDefault: entries.length === 0 }];
}

/** Renames one entry, keeping names valid and unique; a name with nothing usable is ignored. */
export function renameTeammateModel(
  entries: readonly TeammateModelEntry[],
  index: number,
  raw: string,
): TeammateModelEntry[] {
  const slug = teammateModelSlug(raw);
  const current = entries[index];
  if (current === undefined || slug === "" || slug === current.name) return [...entries];
  const taken = new Set(entries.filter((_, at) => at !== index).map((entry) => entry.name));
  const name = uniqueName(slug, taken);
  return entries.map((entry, at) => (at === index ? { ...entry, name } : entry));
}
