import { ProviderInstanceId, type TeammateModelEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chooseTeammateModel } from "./pivotTeammateModels.ts";

const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" };
const entry = (
  name: string,
  modelSelection: typeof codex,
  isDefault = false,
): TeammateModelEntry => ({
  name,
  modelSelection,
  description: "",
  isDefault,
});
const entries = [entry("fast", codex), entry("deep", claude, true)];
const none = { ship: null, scout: null };

describe("chooseTeammateModel", () => {
  it("runs a kind on its own model when no entry is named", () => {
    expect(chooseTeammateModel(entries, { ...none, scout: codex }, { kind: "scout" })).toEqual({
      type: "chosen",
      modelSelection: codex,
      entry: null,
    });
  });

  it("runs an inline task on the ship's model", () => {
    expect(chooseTeammateModel(entries, { ...none, ship: codex }, { kind: "inline" })).toEqual({
      type: "chosen",
      modelSelection: codex,
      entry: null,
    });
  });

  it("lets a named entry win over the kind's model", () => {
    expect(
      chooseTeammateModel(entries, { ...none, ship: codex }, { kind: "ship", modelEntry: "deep" }),
    ).toEqual({ type: "chosen", modelSelection: claude, entry: "deep" });
  });

  it("lets a model the user named win over both", () => {
    expect(
      chooseTeammateModel(
        entries,
        { ...none, ship: codex },
        { kind: "ship", modelSelection: claude },
      ),
    ).toEqual({ type: "chosen", modelSelection: claude, entry: null });
  });

  it("falls back to the default entry for a kind without a model", () => {
    expect(chooseTeammateModel(entries, { ...none, ship: codex }, { kind: "scout" })).toEqual({
      type: "chosen",
      modelSelection: claude,
      entry: "deep",
    });
  });

  it("runs a kind's model even when no entries are set up", () => {
    expect(chooseTeammateModel([], { ...none, ship: codex }, { kind: "ship" })).toEqual({
      type: "chosen",
      modelSelection: codex,
      entry: null,
    });
  });
});
