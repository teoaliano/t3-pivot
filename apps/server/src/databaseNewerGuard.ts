// @effect-diagnostics nodeBuiltinImport:off - Reads the migration ledger before the server's SQL layer opens the database.
import * as NodeSqlite from "node:sqlite";

import { DESKTOP_BACKEND_DATABASE_NEWER_EXIT_CODE } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";

import { migrationEntries } from "./persistence/Migrations.ts";

/**
 * Once a newer build has migrated this T3 home's database, for example a later
 * T3 Pivot or a T3 Code pointed at the same home, this build would run against
 * a schema it does not know.
 */
export class ServerDatabaseNewerError extends Schema.TaggedError<ServerDatabaseNewerError>()(
  "ServerDatabaseNewerError",
  { migration: Schema.String },
) {
  override readonly [Runtime.errorExitCode] = DESKTOP_BACKEND_DATABASE_NEWER_EXIT_CODE;

  override get message(): string {
    return `A newer version already upgraded this data (migration ${this.migration}). Update T3 Pivot before opening it.`;
  }
}

const KNOWN_THROUGH = Math.max(...migrationEntries.map(([id]) => id));

/** The first recorded migration past the newest one this build ships, if any. */
export const readNewerMigration = (dbPath: string, knownThrough = KNOWN_THROUGH) =>
  Effect.try(() => {
    const database = new NodeSqlite.DatabaseSync(dbPath);
    try {
      const ledger = database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
        )
        .get();
      if (ledger === undefined) return undefined;
      const row = database
        .prepare(
          "SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id > ? ORDER BY migration_id LIMIT 1",
        )
        .get(knownThrough) as { migration_id: number; name: string } | undefined;
      return row === undefined ? undefined : `${row.migration_id}_${row.name}`;
    } finally {
      database.close();
    }
  });

/**
 * Refuses to start on a database a newer build migrated. A missing database
 * is new, and an unreadable one is left to the SQL layer to report.
 */
export const ensureDatabaseNotNewer = Effect.fn("ensureDatabaseNotNewer")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(dbPath).pipe(Effect.orElseSucceed(() => false)))) return;
  const migration = yield* readNewerMigration(dbPath).pipe(
    Effect.tapError((cause) => Effect.logWarning("Could not read the migration ledger", { cause })),
    Effect.orElseSucceed(() => undefined),
  );
  if (migration !== undefined) {
    return yield* new ServerDatabaseNewerError({ migration });
  }
});
