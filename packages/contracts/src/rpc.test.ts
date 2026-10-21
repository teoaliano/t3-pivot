import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("WebSocket RPC contracts", () => {
  it("makes every pivotHost method name the home environment it binds to", () => {
    const hostMethods = [...WsRpcGroup.requests.entries()].filter(([method]) =>
      method.startsWith("pivotHost."),
    );
    expect(hostMethods.map(([method]) => method).toSorted()).toEqual(
      [
        "describe",
        "events",
        "land",
        "launchTeammate",
        "mergePullRequest",
        "pullRequestDetail",
        "relaunch",
        "retryLaunch",
        "send",
        "settle",
        "stop",
        "teardown",
      ].map((name) => `pivotHost.${name}`),
    );
    for (const [method, rpc] of hostMethods) {
      const fields = (rpc.payloadSchema as unknown as { readonly fields: object }).fields;
      expect(Object.keys(fields), method).toContain("homeEnvironmentId");
    }
  });

  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});
