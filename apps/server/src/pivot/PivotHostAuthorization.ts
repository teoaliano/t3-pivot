/**
 * PivotHostAuthorization - the one check every `pivotHost.*` call passes before it
 * touches anything: whose host link the session carries, whether that link still
 * stands, which home it belongs to, and which projects and teammates it may name.
 *
 * Nothing about the link comes from the session. The session proves only that a host
 * link issued it (the `pivot:host` scope and a `pivot-host:<grantId>` subject); the
 * allowlist, the revoked mark and the bound home are read from the database on every
 * call, so an edit or a revoke reaches sessions that are already open.
 *
 * @module PivotHostAuthorization
 */
import {
  AuthPivotHostScope,
  type AuthEnvironmentScope,
  type EnvironmentId,
  PivotHostErrorReason,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type HostGrant, PIVOT_HOST_SUBJECT_PREFIX, PivotHostStore } from "./PivotHostStore.ts";

/** A call a host link's session was refused, with a reason the home can act on. */
export class PivotHostRefusedError extends Schema.TaggedError<PivotHostRefusedError>()(
  "PivotHostRefusedError",
  { code: PivotHostErrorReason, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What the session says about itself; the authorization trusts nothing else from it. */
export interface PivotHostCaller {
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
}

/** The caller a connection's session makes: its subject and scopes, and nothing a client sent. */
export const callerOfSession = (session: PivotHostCaller): PivotHostCaller => ({
  subject: session.subject,
  scopes: session.scopes,
});

export interface PivotHostRequest {
  /** The environment ID the home presents; the host link binds to the first one. */
  readonly homeEnvironmentId: EnvironmentId;
  /** A project the call names. It must be on the allowlist. */
  readonly projectId?: ProjectId;
}

const refuse = (code: PivotHostErrorReason, reason: string) =>
  new PivotHostRefusedError({ code, reason });

/** The grant id a subject names, or null for any other subject. */
const grantIdOfSubject = (subject: string) =>
  subject.startsWith(PIVOT_HOST_SUBJECT_PREFIX) && subject.length > PIVOT_HOST_SUBJECT_PREFIX.length
    ? subject.slice(PIVOT_HOST_SUBJECT_PREFIX.length)
    : null;

/**
 * Passes only a session issued by a live host link, for the home that link belongs to,
 * naming only a project on its current allowlist. Returns the link as it stands now.
 */
export const authorize = Effect.fn("PivotHostAuthorization.authorize")(function* (
  caller: PivotHostCaller,
  request: PivotHostRequest,
) {
  const store = yield* PivotHostStore;

  // (i) A host link's session: the scope, and a subject that names a link. A browser,
  // MCP or other session can hold neither.
  const grantId = grantIdOfSubject(caller.subject);
  if (grantId === null || !caller.scopes.includes(AuthPivotHostScope)) {
    return yield* refuse("not-authorized", "This session was not issued by a Pivot host link.");
  }

  // (ii) The link as it stands now. A revoked link refuses every method, and a link that
  // is gone reads the same.
  const revoked = refuse("revoked", "This Pivot host link was revoked.");
  const current = yield* store.getGrant(grantId);
  if (current === null || current.revokedAt !== null) return yield* revoked;

  // (iv) The first call binds the link to its home; every later call must be that home.
  // Binding is one compare-and-set, so of two racing first calls the loser reads the
  // winner back here and is refused.
  const grant =
    current.boundHomeEnvironmentId === null
      ? yield* store.bindHome(grantId, request.homeEnvironmentId)
      : current;
  if (grant === null) return yield* revoked;
  if (grant.boundHomeEnvironmentId !== request.homeEnvironmentId) {
    return yield* refuse(
      "home-mismatch",
      "This Pivot host link belongs to another environment's Pivot.",
    );
  }

  // (iii) A project the call names has to be on the allowlist as it is now.
  if (request.projectId !== undefined && !grant.allowedProjectIds.includes(request.projectId)) {
    return yield* refuse("project-not-allowed", projectNotAllowed(request.projectId, grant));
  }

  return grant;
});

/**
 * Authorizes a call that targets a hosted teammate: a teammate this link created, in a
 * project it still allows. A missing record, one made for another link and one whose
 * project left the allowlist read the same, so the refusal never says whether a thread
 * exists for someone else.
 */
export const authorizeTeammate = Effect.fn("PivotHostAuthorization.authorizeTeammate")(function* (
  caller: PivotHostCaller,
  request: { readonly homeEnvironmentId: EnvironmentId; readonly threadId: ThreadId },
) {
  const store = yield* PivotHostStore;
  const grant = yield* authorize(caller, request);
  const teammate = yield* store.getTeammate(request.threadId);
  if (
    teammate === null ||
    teammate.grantId !== grant.grantId ||
    !grant.allowedProjectIds.includes(teammate.projectId)
  ) {
    return yield* refuse(
      "teammate-not-found",
      `Thread ${request.threadId} is not one of this host link's teammates.`,
    );
  }
  return { grant, teammate };
});

const projectNotAllowed = (projectId: ProjectId, grant: HostGrant) =>
  grant.allowedProjectIds.length === 0
    ? `Project ${projectId} is not allowed: this host link allows no projects.`
    : `Project ${projectId} is not allowed on this host link. Allowed projects: ${grant.allowedProjectIds.join(", ")}.`;
