import {
  ProviderDriverKind,
  type ModelSelection,
  type ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";

/** The agents a Pivot runs on: the ones firstmate's contract is written for. */
export const PIVOT_DRIVERS: ReadonlySet<string> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
  ProviderDriverKind.make("cursor"),
]);

/**
 * The model a new Pivot runs on: the project's or environment's Pivot model
 * when its provider can run one, else what new threads default to.
 */
export function pivotDefaultModel(
  settings: ServerSettings,
  project: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null,
  entries: readonly ProviderInstanceEntry[],
): ModelSelection | null {
  const pivotEntries = entries.filter((entry) => PIVOT_DRIVERS.has(entry.driverKind));
  const configured = resolveProjectSettings(settings, project?.id ?? null, project).settings
    .pivotModelSelection;
  if (
    configured !== null &&
    pivotEntries.some(
      (entry) =>
        entry.instanceId === configured.instanceId &&
        entry.enabled &&
        entry.isAvailable &&
        entry.models.find((model) => model.slug === configured.model)?.isLegacy !== true,
    )
  ) {
    return configured;
  }
  return scheduledTaskDefaultModel(settings, project, pivotEntries);
}
