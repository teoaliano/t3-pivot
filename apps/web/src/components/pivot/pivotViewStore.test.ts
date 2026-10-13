import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { otherPivotViewMode, usePivotViewStore } from "./pivotViewStore";

describe("the header Pivot button", () => {
  it("switches a Pivot to the Pivot view and back to chat", () => {
    const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("pivot-1"));
    const flip = () => {
      const state = usePivotViewStore.getState();
      const mode = state.modeByPivotKey[Object.keys(state.modeByPivotKey)[0] ?? ""] ?? "chat";
      state.setMode(ref, otherPivotViewMode(mode));
      return Object.values(usePivotViewStore.getState().modeByPivotKey)[0];
    };
    expect(flip()).toBe("pivot");
    expect(flip()).toBe("chat");
  });
});
