// @effect-diagnostics nodeBuiltinImport:off - Builds real SQLite files for the guard to read.
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ensureDatabaseNotNewer, ServerDatabaseNewerError } from "./databaseNewerGuard.ts";
import { migrationEntries } from "./persistence/Migrations.ts";

const newest = Math.max(...migrationEntries.map(([id]) => id));

/** A database whose ledger recorded `migrations`, or no ledger at all when null. */
const databaseWith = (migrations: ReadonlyArray<readonly [number, string]> | null) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-db-guard-" });
    const dbPath = path.join(directory, "statev2.sqlite");
    const database = new NodeSqlite.DatabaseSync(dbPath);
    if (migrations !== null) {
      database.exec(
        "CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, created_at TEXT, name TEXT)",
      );
      const insert = database.prepare(
        "INSERT INTO effect_sql_migrations (migration_id, created_at, name) VALUES (?, '', ?)",
      );
      for (const [id, name] of migrations) insert.run(id, name);
    }
    database.close();
    return dbPath;
  });

it.layer(NodeServices.layer)("ensureDatabaseNotNewer", (it) => {
  it.effect("opens a database this build has migrated", () =>
    Effect.gen(function* () {
      const dbPath = yield* databaseWith(migrationEntries.map(([id, name]) => [id, name]));
      yield* ensureDatabaseNotNewer(dbPath);
    }).pipe(Effect.scoped),
  );

  it.effect("opens a missing or never-migrated database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-db-guard-" });
      yield* ensureDatabaseNotNewer(path.join(directory, "statev2.sqlite"));
      yield* ensureDatabaseNotNewer(yield* databaseWith(null));
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a database a newer build migrated, naming the migration", () =>
    Effect.gen(function* () {
      const dbPath = yield* databaseWith([
        [newest, "Current"],
        [newest + 1, "FromNewerT3Code"],
      ]);
      const error = yield* ensureDatabaseNotNewer(dbPath).pipe(Effect.flip);
      assert.instanceOf(error, ServerDatabaseNewerError);
      assert.equal(error.migration, `${newest + 1}_FromNewerT3Code`);
    }).pipe(Effect.scoped),
  );
});
