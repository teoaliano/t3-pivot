import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A managed process is a long-running project script owned by a checkout (a
 * worktree, or a project's main working directory) and supervised by the
 * server. State is memory only: after a server restart there is no process,
 * and a reconnecting client gets a fresh snapshot.
 * See docs/internals/managed-processes.md.
 */

/** `starting` until the reserved port answers with a web page, then `running`. */
export const ManagedProcessStatus = Schema.Literals(["starting", "running", "stopped"]);
export type ManagedProcessStatus = typeof ManagedProcessStatus.Type;

export const ManagedProcess = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  scriptId: TrimmedNonEmptyString,
  scriptName: TrimmedNonEmptyString,
  status: ManagedProcessStatus,
  /** First port of the checkout's reserved block, exported to the script as `PORT`. */
  port: Schema.Int,
  /** Pinned processes are never stopped for being idle. */
  pinned: Schema.Boolean,
  /** Why a process that exited on its own stopped. Null after a clean stop. */
  lastError: Schema.NullOr(Schema.String),
  /** The terminal the process runs in, so a client can attach to its output. */
  terminal: Schema.Struct({
    threadId: TrimmedNonEmptyString,
    terminalId: TrimmedNonEmptyString,
  }),
});
export type ManagedProcess = typeof ManagedProcess.Type;

/** A `package.json` dev script the checkout offers when its project declares no dev action. */
export const DetectedDevScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
});
export type DetectedDevScript = typeof DetectedDevScript.Type;

/** Every process this checkout has run since the server started, stopped ones included. */
export const ManagedProcessCheckoutSnapshot = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  processes: Schema.Array(ManagedProcess),
  /** Optional so older servers still decode. Read once per subscription. */
  detectedScript: Schema.optional(Schema.NullOr(DetectedDevScript)),
});
export type ManagedProcessCheckoutSnapshot = typeof ManagedProcessCheckoutSnapshot.Type;

/** Every process across the environment's checkouts that is live or pinned. */
export const ManagedProcessOverview = Schema.Struct({
  processes: Schema.Array(ManagedProcess),
});
export type ManagedProcessOverview = typeof ManagedProcessOverview.Type;

export const ManagedProcessSubscribeInput = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
});
export type ManagedProcessSubscribeInput = typeof ManagedProcessSubscribeInput.Type;

/** The checkout is the thread's worktree, or its project's root when it has none. */
export const ManagedProcessStartInput = Schema.Struct({
  threadId: ThreadId,
  scriptId: TrimmedNonEmptyString,
  /** Move the checkout to a new port block first, the answer to a port conflict. */
  reallocate: Schema.optional(Schema.Boolean),
});
export type ManagedProcessStartInput = typeof ManagedProcessStartInput.Type;

export const ManagedProcessTarget = Schema.Struct({
  checkoutPath: TrimmedNonEmptyString,
  scriptId: TrimmedNonEmptyString,
});
export type ManagedProcessTarget = typeof ManagedProcessTarget.Type;

export const ManagedProcessSetPinnedInput = Schema.Struct({
  ...ManagedProcessTarget.fields,
  pinned: Schema.Boolean,
});
export type ManagedProcessSetPinnedInput = typeof ManagedProcessSetPinnedInput.Type;

/**
 * The checkout's reserved port is held by a process this server did not
 * start. The occupant is named, never stopped. Reallocating the block is the
 * way out.
 */
export class ManagedProcessPortOccupiedError extends Schema.TaggedError<ManagedProcessPortOccupiedError>()(
  "ManagedProcessPortOccupiedError",
  {
    checkoutPath: Schema.String,
    port: Schema.Int,
    occupantPid: Schema.NullOr(Schema.Int),
    occupantProcessName: Schema.NullOr(Schema.String),
    occupantCommand: Schema.NullOr(Schema.String),
  },
) {
  override get message() {
    const occupant = this.occupantProcessName ?? this.occupantCommand ?? "another process";
    return `Port ${this.port} reserved for ${this.checkoutPath} is held by ${occupant}.`;
  }
}

export class ManagedProcessPortsExhaustedError extends Schema.TaggedError<ManagedProcessPortsExhaustedError>()(
  "ManagedProcessPortsExhaustedError",
  { checkoutPath: Schema.String },
) {
  override get message() {
    return `No free port block is left to reserve for ${this.checkoutPath}.`;
  }
}

export class ManagedProcessScriptNotFoundError extends Schema.TaggedError<ManagedProcessScriptNotFoundError>()(
  "ManagedProcessScriptNotFoundError",
  {
    scriptId: Schema.String,
    availableScripts: Schema.Array(Schema.String),
  },
) {
  override get message() {
    const available =
      this.availableScripts.length > 0 ? this.availableScripts.join(", ") : "none configured";
    return `Project script "${this.scriptId}" was not found. Available scripts: ${available}.`;
  }
}

export class ManagedProcessThreadNotFoundError extends Schema.TaggedError<ManagedProcessThreadNotFoundError>()(
  "ManagedProcessThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message() {
    return `Thread ${this.threadId} or its project was not found.`;
  }
}

export class ManagedProcessStartError extends Schema.TaggedError<ManagedProcessStartError>()(
  "ManagedProcessStartError",
  {
    checkoutPath: Schema.String,
    scriptId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to start "${this.scriptId}" in ${this.checkoutPath}.`;
  }
}

export const ManagedProcessStartFailure = Schema.Union([
  ManagedProcessPortOccupiedError,
  ManagedProcessPortsExhaustedError,
  ManagedProcessScriptNotFoundError,
  ManagedProcessThreadNotFoundError,
  ManagedProcessStartError,
]);
export type ManagedProcessStartFailure = typeof ManagedProcessStartFailure.Type;
