import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideNewPivot, replacePivotPrompt, resolveNewPivotProjectRef } from "./newPivot.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const localApp = scopeProjectRef(local, ProjectId.make("app-local"));
const remoteApp = scopeProjectRef(remote, ProjectId.make("app-remote"));
const other = scopeProjectRef(local, ProjectId.make("other"));

describe("resolveNewPivotProjectRef", () => {
  const everywhere = () => true;

  it("lands in the picked project's own copy", () => {
    expect(
      resolveNewPivotProjectRef({
        targetRef: localApp,
        memberRefs: [localApp, remoteApp],
        contextualRef: other,
        supportsPivot: everywhere,
      }),
    ).toEqual(localApp);
  });

  it("prefers the copy the user is in when it belongs to the picked project", () => {
    expect(
      resolveNewPivotProjectRef({
        targetRef: localApp,
        memberRefs: [localApp, remoteApp],
        contextualRef: remoteApp,
        supportsPivot: everywhere,
      }),
    ).toEqual(remoteApp);
  });

  it("skips copies on environments without Pivot mode", () => {
    expect(
      resolveNewPivotProjectRef({
        targetRef: localApp,
        memberRefs: [localApp, remoteApp],
        contextualRef: localApp,
        supportsPivot: (environmentId) => environmentId === remote,
      }),
    ).toEqual(remoteApp);
  });

  it("hides a project no environment can run a Pivot in", () => {
    expect(
      resolveNewPivotProjectRef({
        targetRef: localApp,
        memberRefs: [localApp],
        contextualRef: null,
        supportsPivot: () => false,
      }),
    ).toBeNull();
  });
});

describe("decideNewPivot", () => {
  const takeover = { liveTeammates: 2, openDecisions: 1 };

  it("creates directly when the project has no unsettled Pivot", async () => {
    let asked = false;
    const decision = await decideNewPivot(null, async () => {
      asked = true;
      return true;
    });
    expect(decision).toBe("create");
    expect(asked).toBe(false);
  });

  it("replaces the unsettled Pivot once confirmed", async () => {
    expect(await decideNewPivot(takeover, async () => true)).toBe("replace");
  });

  it("creates nothing when the replacement is declined", async () => {
    expect(await decideNewPivot(takeover, async () => false)).toBe("cancel");
  });

  it("names the project and what the new Pivot inherits", () => {
    expect(replacePivotPrompt("App", takeover)).toBe(
      "Replace the Pivot in App?\nThe new Pivot inherits its 2 live teammates and 1 open decision. The current Pivot retires and stays as read-only history.",
    );
  });
});
