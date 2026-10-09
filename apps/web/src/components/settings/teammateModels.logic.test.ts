import { ProviderInstanceId, type TeammateModelEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addTeammateModel,
  defaultTeammateModelIndex,
  renameTeammateModel,
  teammateModelSlug,
} from "./teammateModels.logic";

const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const entry = (name: string, isDefault = false): TeammateModelEntry => ({
  name,
  modelSelection: model,
  description: "",
  isDefault,
});

describe("teammate models", () => {
  it("makes the first entry added the default and keeps names unique", () => {
    const first = addTeammateModel([], model);
    expect(first).toEqual([entry("model", true)]);
    expect(addTeammateModel(first, model).map((added) => [added.name, added.isDefault])).toEqual([
      ["model", true],
      ["model-2", false],
    ]);
  });

  it("falls back to the first entry when none is marked default", () => {
    expect(defaultTeammateModelIndex([entry("a"), entry("b", true)])).toBe(1);
    expect(defaultTeammateModelIndex([entry("a"), entry("b")])).toBe(0);
  });

  it("turns typed names into unique slugs and ignores unusable ones", () => {
    expect(teammateModelSlug("  Heavy Coding! ")).toBe("heavy-coding");
    const entries = [entry("research"), entry("model")];
    expect(renameTeammateModel(entries, 1, "Research")[1]?.name).toBe("research-2");
    expect(renameTeammateModel(entries, 1, "Quick fix")[1]?.name).toBe("quick-fix");
    expect(renameTeammateModel(entries, 1, "!!!")[1]?.name).toBe("model");
  });
});
