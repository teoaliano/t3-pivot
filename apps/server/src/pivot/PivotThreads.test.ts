import { describe, expect, it } from "@effect/vitest";
import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";

import { setupScriptOutcome, toPivotThreadEvents } from "./PivotThreads.ts";

const threadId = ThreadId.make("teammate-1");

const message = (fields: Record<string, unknown>) =>
  ({
    type: "message.updated",
    threadId,
    payload: {
      id: MessageId.make("message-1"),
      role: "user",
      createdBy: "user",
      text: "Use the new auth library instead.",
      ...fields,
    },
  }) as never;

const answered = (commandId: string | null) => ({
  commandId: commandId === null ? null : CommandId.make(commandId),
  event: {
    type: "runtime-request.updated",
    threadId,
    payload: { status: "resolved", decision: "accept" },
  } as never,
});

describe("toPivotThreadEvents", () => {
  it("reads a message the user typed into the thread as theirs", () => {
    expect(toPivotThreadEvents({ commandId: null, event: message({}) })).toEqual([
      { type: "activity", threadId },
      {
        type: "user-message",
        threadId,
        messageId: "message-1",
        text: "Use the new auth library instead.",
      },
    ]);
  });

  it("does not read the Pivot's messages or notifications as the user's", () => {
    for (const fields of [
      { createdBy: "agent", senderThreadId: ThreadId.make("pivot") },
      { notification: { source: { kind: "teammate" } } },
    ]) {
      expect(toPivotThreadEvents({ commandId: null, event: message(fields) })).toEqual([
        { type: "activity", threadId },
      ]);
    }
  });

  it("reports an answered approval only when no agent's tool answered it", () => {
    expect(toPivotThreadEvents(answered("client:abc"))).toContainEqual({
      type: "request-answered",
      threadId,
      answer: "Approval: accept",
    });
    expect(toPivotThreadEvents(answered("mcp:abc"))).toEqual([{ type: "activity", threadId }]);
  });
});

describe("setupScriptOutcome", () => {
  const snapshot = (stage: Record<string, unknown> | null, script = true) =>
    ({
      setupScript: script ? { name: "setup", command: "pnpm i", terminalId: "setup-1" } : null,
      stages:
        stage === null
          ? []
          : [{ id: "setup-script", detail: null, tail: [], percent: null, ...stage }],
      error: null,
    }) as never;

  it("reads the setup-script stage, and none when the project has no script", () => {
    expect(setupScriptOutcome(null)).toEqual({ status: "none", detail: null });
    expect(setupScriptOutcome(snapshot({ status: "skipped" }, false))).toEqual({
      status: "none",
      detail: null,
    });
    expect(setupScriptOutcome(snapshot({ status: "running" }))).toEqual({
      status: "running",
      detail: null,
    });
    expect(setupScriptOutcome(snapshot({ status: "done" }))).toEqual({
      status: "succeeded",
      detail: null,
    });
    expect(
      setupScriptOutcome(
        snapshot({ status: "failed", detail: "exited with 1", tail: ["ERR! missing dep"] }),
      ),
    ).toEqual({ status: "failed", detail: "exited with 1" });
  });
});
