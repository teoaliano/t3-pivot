/**
 * PivotDatabase - Pivot mode's own SQLite database, `pivot.sqlite`, next to V2's
 * `statev2.sqlite` in the userdata folder.
 *
 * T3 Code opens `statev2.sqlite` too and decodes it strictly, so Pivot mode keeps
 * its records here instead: its own migrations, its own event log, and the
 * projections derived from it. The client sits behind its own tag so it never
 * shadows the main `SqlClient`.
 *
 * @module PivotDatabase
 */
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import Migration0001 from "./migrations/001_PivotStore.ts";

export class PivotSql extends Context.Service<PivotSql, SqlClient.SqlClient>()(
  "t3/pivot/PivotDatabase/PivotSql",
) {}

const loader = Migrator.fromRecord({ "1_PivotStore": Migration0001 });

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* Migrator.make({})({ loader });
  }),
);

const fromClient = Layer.effect(
  PivotSql,
  Effect.gen(function* () {
    return yield* SqlClient.SqlClient;
  }),
);

const clientLayer = (filename: string) =>
  fromClient.pipe(
    Layer.provide(
      Layer.provideMerge(
        setup,
        NodeSqliteClient.layer({
          filename,
          spanAttributes: { "db.name": "pivot.sqlite", "service.name": "t3code-server" },
        }),
      ),
    ),
  );

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(config.stateDir, { recursive: true });
    return clientLayer(path.join(config.stateDir, "pivot.sqlite"));
  }),
);

export const layerMemory = clientLayer(":memory:");
