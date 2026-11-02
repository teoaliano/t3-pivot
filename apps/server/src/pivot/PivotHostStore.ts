/**
 * PivotHostStore - what this environment records as a host for another environment's
 * Pivot: the host links ("grants") that home may use, the teammates it runs for each,
 * and the log of what happened to them.
 *
 * Plain tables in `pivot.sqlite`, beside the event-sourced Pivot store: a host holds no
 * Pivot, so none of this feeds a wake or a projection. Reads always go to the database,
 * so an allowlist edit or a revoke is seen by the next call of a session already open.
 * The one in-memory set is the live hosted thread ids, which the supervisor consults for
 * every V2 event.
 *
 * @module PivotHostStore
 */
import {
  type EnvironmentId,
  type IsoDateTime,
  PivotHostEventBody,
  type PivotDeliveryMode,
  ProjectId,
  type RunId,
  type TeammateKind,
  type ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as PivotDatabase from "./PivotDatabase.ts";
import { PivotStoreError } from "./PivotStore.ts";

/** The subject of every session a host link issues. Nothing else may carry it. */
export const PIVOT_HOST_SUBJECT_PREFIX = "pivot-host:";

export const pivotHostSubject = (grantId: string) => `${PIVOT_HOST_SUBJECT_PREFIX}${grantId}`;

/** What a host link allows. The allowlist and bound home are empty once it is revoked. */
export interface HostGrant {
  readonly grantId: string;
  readonly subject: string;
  readonly allowedProjectIds: ReadonlyArray<ProjectId>;
  /** The home that made the link's first call; every later call must be the same one. */
  readonly boundHomeEnvironmentId: EnvironmentId | null;
  readonly createdAt: IsoDateTime;
  readonly revokedAt: IsoDateTime | null;
}

/** A teammate this environment runs for a grant's home. */
export interface HostedTeammate {
  readonly threadId: ThreadId;
  readonly grantId: string;
  readonly dispatchId: string;
  readonly projectId: ProjectId;
  /** The Pivot's thread on the home. It is not a thread here. */
  readonly pivotThreadId: ThreadId;
  readonly pivotLabel: string;
  readonly kind: TeammateKind;
  readonly title: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly deliveryMode: PivotDeliveryMode;
  readonly firstRunId: RunId | null;
  readonly createdAt: IsoDateTime;
  readonly tornDownAt: IsoDateTime | null;
}

export type NewHostedTeammate = Omit<HostedTeammate, "createdAt" | "tornDownAt">;

export interface HostedEntry {
  readonly sequence: number;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly occurredAt: IsoDateTime;
  readonly event: PivotHostEventBody;
}

export class PivotHostStore extends Context.Service<
  PivotHostStore,
  {
    /** A new link allowing `allowedProjectIds`. Its home binds on its first call. */
    readonly createGrant: (input: {
      readonly allowedProjectIds: ReadonlyArray<ProjectId>;
    }) => Effect.Effect<HostGrant, PivotStoreError>;
    readonly getGrant: (grantId: string) => Effect.Effect<HostGrant | null, PivotStoreError>;
    /** Every link, revoked ones included. The rows hold no credential. */
    readonly listGrants: Effect.Effect<ReadonlyArray<HostGrant>, PivotStoreError>;
    /** Null when the link does not exist or was revoked. */
    /**
     * Replaces the allowlist; null when the link does not exist or was revoked. Teammates in
     * a project that left it are no longer live, and are returned so they can be stopped:
     * their home can no longer reach them. Teammates in a project back on it are live again.
     */
    readonly setAllowlist: (
      grantId: string,
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<
      { readonly grant: HostGrant; readonly dropped: ReadonlyArray<ThreadId> } | null,
      PivotStoreError
    >;
    /** Empties the allowlist and the bound home. False when it does not exist or already was. */
    readonly revokeGrant: (grantId: string) => Effect.Effect<boolean, PivotStoreError>;
    /**
     * Binds the link to `homeEnvironmentId` when it has no home yet, in one statement, so
     * two racing first calls cannot both bind. Returns the link as it stands afterwards:
     * the caller compares the bound home with its own. Null when missing or revoked.
     */
    readonly bindHome: (
      grantId: string,
      homeEnvironmentId: EnvironmentId,
    ) => Effect.Effect<HostGrant | null, PivotStoreError>;
    /**
     * Records the teammate, or returns the one the grant's `dispatchId` already made
     * (`created` is false). Null, with nothing written, when the link was revoked or already
     * has `maxLive` teammates not torn down; the caller reads the grant to tell which. The cap
     * is part of the insert, under the store's one writer, so concurrent launches cannot pass
     * it together.
     */
    readonly recordTeammate: (
      input: NewHostedTeammate,
      options?: { readonly maxLive?: number },
    ) => Effect.Effect<
      { readonly teammate: HostedTeammate; readonly created: boolean } | null,
      PivotStoreError
    >;
    /** How many of the grant's teammates are not torn down. */
    readonly countLive: (grantId: string) => Effect.Effect<number, PivotStoreError>;
    /** The grant's teammates not torn down, whether or not the link still stands. */
    readonly liveThreadIdsOf: (
      grantId: string,
    ) => Effect.Effect<ReadonlyArray<ThreadId>, PivotStoreError>;
    readonly findByDispatch: (
      grantId: string,
      dispatchId: string,
    ) => Effect.Effect<HostedTeammate | null, PivotStoreError>;
    readonly getTeammate: (
      threadId: ThreadId,
    ) => Effect.Effect<HostedTeammate | null, PivotStoreError>;
    /**
     * Whether the thread is a hosted teammate not yet torn down, of a link that stands and
     * still allows its project. Answers from memory.
     */
    readonly isLive: (threadId: ThreadId) => Effect.Effect<boolean>;
    /** Every hosted teammate `isLive` holds, from memory. */
    readonly liveThreadIds: Effect.Effect<ReadonlyArray<ThreadId>>;
    readonly markTornDown: (threadId: ThreadId) => Effect.Effect<void, PivotStoreError>;
    /** Appends to the grant's log. Null when the thread is not a hosted teammate. */
    readonly appendEvent: (input: {
      readonly threadId: ThreadId;
      readonly event: PivotHostEventBody;
    }) => Effect.Effect<HostedEntry | null, PivotStoreError>;
    /** The grant's entries after the cursor, oldest first. */
    readonly entriesAfter: (input: {
      readonly grantId: string;
      readonly afterSequence: number;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<HostedEntry>, PivotStoreError>;
    /**
     * Subscribes now to the grant ids whose entries or access change, as each change
     * commits. The stream emits nothing for what committed before the call returned.
     */
    readonly subscribe: Effect.Effect<Stream.Stream<string>, never, Scope.Scope>;
  }
>()("t3/pivot/PivotHostStore") {}

interface GrantSqlRow {
  readonly grant_id: string;
  readonly subject: string;
  readonly allowed_project_ids: string;
  readonly bound_home_environment_id: string | null;
  readonly created_at: string;
  readonly revoked_at: string | null;
}

interface TeammateSqlRow {
  readonly thread_id: string;
  readonly grant_id: string;
  readonly dispatch_id: string;
  readonly project_id: string;
  readonly pivot_thread_id: string;
  readonly pivot_label: string;
  readonly kind: string;
  readonly title: string;
  readonly branch: string;
  readonly base_branch: string;
  readonly worktree_path: string;
  readonly delivery_mode: string;
  readonly first_run_id: string | null;
  readonly created_at: string;
  readonly torn_down_at: string | null;
}

interface EntrySqlRow {
  readonly sequence: number;
  readonly thread_id: string;
  readonly project_id: string;
  readonly payload_json: string;
  readonly occurred_at: string;
}

const AllowlistJson = Schema.fromJsonString(Schema.Array(ProjectId));
const decodeAllowlist = Schema.decodeUnknownSync(AllowlistJson);
const encodeAllowlist = Schema.encodeSync(AllowlistJson);
const EventJson = Schema.fromJsonString(PivotHostEventBody);
const decodeEvent = Schema.decodeUnknownSync(EventJson);
const encodeEvent = Schema.encodeSync(EventJson);

// Rows are written only through this module, so ids read back carry their brands.
const toGrant = (row: GrantSqlRow): HostGrant => ({
  grantId: row.grant_id,
  subject: row.subject,
  allowedProjectIds: decodeAllowlist(row.allowed_project_ids),
  boundHomeEnvironmentId: row.bound_home_environment_id as EnvironmentId | null,
  createdAt: row.created_at,
  revokedAt: row.revoked_at,
});

const toTeammate = (row: TeammateSqlRow): HostedTeammate => ({
  threadId: row.thread_id as ThreadId,
  grantId: row.grant_id,
  dispatchId: row.dispatch_id,
  projectId: row.project_id as ProjectId,
  pivotThreadId: row.pivot_thread_id as ThreadId,
  pivotLabel: row.pivot_label,
  kind: row.kind as TeammateKind,
  title: row.title,
  branch: row.branch,
  baseBranch: row.base_branch,
  worktreePath: row.worktree_path,
  deliveryMode: row.delivery_mode as PivotDeliveryMode,
  firstRunId: row.first_run_id as RunId | null,
  createdAt: row.created_at,
  tornDownAt: row.torn_down_at,
});

const toEntry = (row: EntrySqlRow): HostedEntry => ({
  sequence: row.sequence,
  threadId: row.thread_id as ThreadId,
  projectId: row.project_id as ProjectId,
  occurredAt: row.occurred_at,
  event: decodeEvent(row.payload_json),
});

/** Signals a subscriber may fall behind by before the oldest are dropped. */
const SIGNAL_BUFFER = 64;

export const make = Effect.gen(function* () {
  const sql = yield* PivotDatabase.PivotSql;
  // One writer at a time, and signals leave in commit order.
  const writeLock = yield* Semaphore.make(1);
  // A signal only says "re-read from your cursor". A subscriber that falls behind loses the
  // oldest, and re-reads on every signal it does get, so a lost one is covered by the next.
  const signals = yield* PubSub.sliding<string>(SIGNAL_BUFFER);
  // Teammates of a revoked link are not live: their sessions are stopped, and a restart
  // does not resume them.
  // Nor are teammates whose project left their link's allowlist.
  const live = new Set<string>(
    (yield* sql<{
      readonly thread_id: string;
      readonly project_id: string;
      readonly allowed_project_ids: string;
    }>`
      SELECT t.thread_id, t.project_id, g.allowed_project_ids FROM pivot_hosted_teammates t
      JOIN pivot_host_grants g ON g.grant_id = t.grant_id
      WHERE t.torn_down_at IS NULL AND g.revoked_at IS NULL
    `.pipe(Effect.orDie))
      .filter((row) =>
        (decodeAllowlist(row.allowed_project_ids) as ReadonlyArray<string>).includes(
          row.project_id,
        ),
      )
      .map((row) => row.thread_id),
  );

  const storeError = (operation: string) => (cause: unknown) =>
    new PivotStoreError({ operation: `host ${operation}`, cause });
  const read = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError(storeError(operation)));
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const readGrant = (grantId: string) =>
    sql<GrantSqlRow>`SELECT * FROM pivot_host_grants WHERE grant_id = ${grantId}`.pipe(
      Effect.map((rows) => (rows[0] ? toGrant(rows[0]) : null)),
    );
  const readTeammate = (threadId: string) =>
    sql<TeammateSqlRow>`SELECT * FROM pivot_hosted_teammates WHERE thread_id = ${threadId}`.pipe(
      Effect.map((rows) => (rows[0] ? toTeammate(rows[0]) : null)),
    );
  const readByDispatch = (grantId: string, dispatchId: string) =>
    sql<TeammateSqlRow>`
      SELECT * FROM pivot_hosted_teammates
      WHERE grant_id = ${grantId} AND dispatch_id = ${dispatchId}
    `.pipe(Effect.map((rows) => (rows[0] ? toTeammate(rows[0]) : null)));

  const liveThreadIdsOf = (grantId: string) =>
    sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM pivot_hosted_teammates
      WHERE grant_id = ${grantId} AND torn_down_at IS NULL
      ORDER BY created_at, rowid
    `.pipe(Effect.map((rows) => rows.map((row) => row.thread_id as ThreadId)));

  /** Runs a write under the lock and in a transaction, then tells subscribers. */
  const write = <A, E>(
    operation: string,
    grantIdOf: (result: A) => string | null,
    effect: Effect.Effect<A, E>,
    // Runs once the write committed, still under the lock, so the in-memory live set
    // changes in the same order as the rows.
    onCommit?: (result: A) => void,
  ) =>
    writeLock.withPermits(1)(
      effect.pipe(
        sql.withTransaction,
        Effect.mapError(storeError(operation)),
        Effect.tap((result) => Effect.sync(() => onCommit?.(result))),
        Effect.tap((result) => {
          const grantId = grantIdOf(result);
          return grantId === null ? Effect.void : PubSub.publish(signals, grantId);
        }),
      ),
    );

  const createGrant = Effect.fn("PivotHostStore.createGrant")(function* ({
    allowedProjectIds,
  }: Parameters<PivotHostStore["Service"]["createGrant"]>[0]) {
    const grantId = `grant-${yield* randomUuidV4}`;
    const createdAt = yield* now;
    return yield* write(
      "createGrant",
      () => null,
      Effect.gen(function* () {
        yield* sql`
            INSERT INTO pivot_host_grants (grant_id, subject, allowed_project_ids, created_at)
            VALUES (${grantId}, ${pivotHostSubject(grantId)}, ${encodeAllowlist([...new Set(allowedProjectIds)])}, ${createdAt})
          `;
        return (yield* readGrant(grantId))!;
      }),
    );
  });

  const setAllowlist: PivotHostStore["Service"]["setAllowlist"] = (grantId, projectIds) =>
    write(
      "setAllowlist",
      (result) => (result === null ? null : result.grant.grantId),
      Effect.gen(function* () {
        yield* sql`
          UPDATE pivot_host_grants
          SET allowed_project_ids = ${encodeAllowlist([...new Set(projectIds)])}
          WHERE grant_id = ${grantId} AND revoked_at IS NULL
        `;
        const grant = yield* readGrant(grantId);
        if (grant === null || grant.revokedAt !== null) return null;
        const running = yield* sql<{ readonly thread_id: string; readonly project_id: string }>`
          SELECT thread_id, project_id FROM pivot_hosted_teammates
          WHERE grant_id = ${grantId} AND torn_down_at IS NULL
        `;
        const allowed = new Set<string>(grant.allowedProjectIds);
        return {
          grant,
          kept: running.filter((row) => allowed.has(row.project_id)).map((row) => row.thread_id),
          dropped: running
            .filter((row) => !allowed.has(row.project_id))
            .map((row) => row.thread_id as ThreadId),
        };
      }),
      (result) => {
        result?.kept.forEach((id) => live.add(id));
        result?.dropped.forEach((id) => live.delete(id));
      },
    ).pipe(
      Effect.map((result) =>
        result === null ? null : { grant: result.grant, dropped: result.dropped },
      ),
    );

  const revokeGrant = Effect.fn("PivotHostStore.revokeGrant")(function* (grantId: string) {
    const revokedAt = yield* now;
    const revoked = yield* write(
      "revokeGrant",
      (result) => (result === null ? null : grantId),
      Effect.gen(function* () {
        const before = yield* readGrant(grantId);
        if (before === null || before.revokedAt !== null) return null;
        yield* sql`
            UPDATE pivot_host_grants
            SET allowed_project_ids = '[]', bound_home_environment_id = NULL, revoked_at = ${revokedAt}
            WHERE grant_id = ${grantId} AND revoked_at IS NULL
          `;
        return yield* liveThreadIdsOf(grantId);
      }),
      (ids) => ids?.forEach((id) => live.delete(id)),
    );
    return revoked !== null;
  });

  const bindHome: PivotHostStore["Service"]["bindHome"] = (grantId, homeEnvironmentId) =>
    write(
      "bindHome",
      () => null,
      Effect.gen(function* () {
        // The `IS NULL` test and the write are one statement: of two racing first calls,
        // only the first to run changes the row, and the second reads its winner back.
        yield* sql`
          UPDATE pivot_host_grants SET bound_home_environment_id = ${homeEnvironmentId}
          WHERE grant_id = ${grantId} AND revoked_at IS NULL
            AND bound_home_environment_id IS NULL
        `;
        const grant = yield* readGrant(grantId);
        return grant === null || grant.revokedAt !== null ? null : grant;
      }),
    );

  const recordTeammate = Effect.fn("PivotHostStore.recordTeammate")(function* (
    input: Parameters<PivotHostStore["Service"]["recordTeammate"]>[0],
    options?: Parameters<PivotHostStore["Service"]["recordTeammate"]>[1],
  ) {
    const createdAt = yield* now;
    return yield* write(
      "recordTeammate",
      () => null,
      Effect.gen(function* () {
        // Inserted only while the link stands and allows the project, in the same
        // statement, so a revoke or allowlist edit that lands while a launch runs cannot
        // leave a record behind.
        yield* sql`
            INSERT INTO pivot_hosted_teammates (
              thread_id, grant_id, dispatch_id, project_id, pivot_thread_id, pivot_label, kind,
              title, branch, base_branch, worktree_path, delivery_mode, first_run_id, created_at
            )
            SELECT
              ${input.threadId}, ${input.grantId}, ${input.dispatchId}, ${input.projectId},
              ${input.pivotThreadId}, ${input.pivotLabel}, ${input.kind}, ${input.title},
              ${input.branch}, ${input.baseBranch}, ${input.worktreePath}, ${input.deliveryMode},
              ${input.firstRunId}, ${createdAt}
            WHERE EXISTS (
              SELECT 1 FROM pivot_host_grants g, json_each(g.allowed_project_ids) allowed
              WHERE g.grant_id = ${input.grantId} AND g.revoked_at IS NULL
                AND allowed.value = ${input.projectId}
            )
              AND (
                SELECT COUNT(*) FROM pivot_hosted_teammates
                WHERE grant_id = ${input.grantId} AND torn_down_at IS NULL
              ) < ${options?.maxLive ?? Number.MAX_SAFE_INTEGER}
            ON CONFLICT (grant_id, dispatch_id) DO NOTHING
          `;
        const teammate = yield* readByDispatch(input.grantId, input.dispatchId);
        return teammate === null
          ? null
          : { teammate, created: teammate.threadId === input.threadId };
      }),
      (recorded) => {
        if (recorded?.created) live.add(recorded.teammate.threadId);
      },
    );
  });

  const markTornDown = Effect.fn("PivotHostStore.markTornDown")(function* (threadId: ThreadId) {
    const tornDownAt = yield* now;
    yield* write(
      "markTornDown",
      () => null,
      sql`
          UPDATE pivot_hosted_teammates SET torn_down_at = ${tornDownAt}
          WHERE thread_id = ${threadId} AND torn_down_at IS NULL
        `,
      () => live.delete(threadId),
    );
  });

  const appendEvent = Effect.fn("PivotHostStore.appendEvent")(function* ({
    threadId,
    event,
  }: Parameters<PivotHostStore["Service"]["appendEvent"]>[0]) {
    const occurredAt = yield* now;
    const appended = yield* write(
      "appendEvent",
      (result) => result?.grantId ?? null,
      Effect.gen(function* () {
        const teammate = yield* readTeammate(threadId);
        if (teammate === null) return null;
        const rows = yield* sql<{ readonly sequence: number }>`
            INSERT INTO pivot_hosted_events (grant_id, thread_id, project_id, payload_json, occurred_at)
            VALUES (${teammate.grantId}, ${threadId}, ${teammate.projectId}, ${encodeEvent(event)}, ${occurredAt})
            RETURNING sequence
          `;
        return {
          grantId: teammate.grantId,
          entry: {
            sequence: rows[0]!.sequence,
            threadId,
            projectId: teammate.projectId,
            occurredAt,
            event,
          } satisfies HostedEntry,
        };
      }),
    );
    return appended?.entry ?? null;
  });

  return PivotHostStore.of({
    createGrant,
    // Reads and liveness checks run per hosted event and per poll, so they stay untraced.
    getGrant: Effect.fnUntraced(function* (grantId) {
      return yield* read("getGrant", readGrant(grantId));
    }),
    listGrants: read(
      "listGrants",
      sql<GrantSqlRow>`SELECT * FROM pivot_host_grants ORDER BY created_at, rowid`.pipe(
        Effect.map((rows) => rows.map(toGrant)),
      ),
    ),
    setAllowlist,
    revokeGrant,
    bindHome,
    recordTeammate,
    countLive: Effect.fnUntraced(function* (grantId) {
      return yield* read(
        "countLive",
        sql<{ readonly live: number }>`
          SELECT COUNT(*) AS live FROM pivot_hosted_teammates
          WHERE grant_id = ${grantId} AND torn_down_at IS NULL
        `.pipe(Effect.map((rows) => rows[0]?.live ?? 0)),
      );
    }),
    liveThreadIdsOf: Effect.fnUntraced(function* (grantId) {
      return yield* read("liveThreadIdsOf", liveThreadIdsOf(grantId));
    }),
    findByDispatch: Effect.fnUntraced(function* (grantId, dispatchId) {
      return yield* read("findByDispatch", readByDispatch(grantId, dispatchId));
    }),
    getTeammate: Effect.fnUntraced(function* (threadId) {
      return yield* read("getTeammate", readTeammate(threadId));
    }),
    isLive: Effect.fnUntraced(function* (threadId) {
      return live.has(threadId);
    }),
    liveThreadIds: Effect.sync(() => [...live] as Array<ThreadId>),
    markTornDown,
    appendEvent,
    entriesAfter: Effect.fnUntraced(function* ({ grantId, afterSequence, limit }) {
      return yield* read(
        "entriesAfter",
        sql<EntrySqlRow>`
          SELECT sequence, thread_id, project_id, payload_json, occurred_at
          FROM pivot_hosted_events
          WHERE grant_id = ${grantId} AND sequence > ${afterSequence}
          ORDER BY sequence
          LIMIT ${limit}
        `.pipe(Effect.map((rows) => rows.map(toEntry))),
      );
    }),
    subscribe: Effect.map(PubSub.subscribe(signals), (subscription) =>
      Stream.fromSubscription(subscription),
    ),
  });
});

export const layer = Layer.effect(PivotHostStore, make);
