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
import Migration0002 from "./migrations/002_DecisionApproval.ts";
import Migration0003 from "./migrations/003_PullRequestStates.ts";
import Migration0004 from "./migrations/004_TeammateModelEntry.ts";
import Migration0005 from "./migrations/005_TeammateEnvironment.ts";
import Migration0006 from "./migrations/006_PivotHost.ts";
import Migration0007 from "./migrations/007_TeammateMemoryWait.ts";
import Migration0008 from "./migrations/008_DecisionAttachments.ts";
import Migration0009 from "./migrations/009_ReviewThenShip.ts";

export class PivotSql extends Context.Service<PivotSql, SqlClient.SqlClient>()(
  "t3/pivot/PivotDatabase/PivotSql",
) {}

const loader = Migrator.fromRecord({
  "1_PivotStore": Migration0001,
  "2_DecisionApproval": Migration0002,
  "3_PullRequestStates": Migration0003,
  "4_TeammateModelEntry": Migration0004,
  "5_TeammateEnvironment": Migration0005,
  "6_PivotHost": Migration0006,
  "7_TeammateMemoryWait": Migration0007,
  "8_DecisionAttachments": Migration0008,
  "9_ReviewThenShip": Migration0009,
});

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* Migrator.make({})({ loader });
  }),
);

const fromClient = Layer.effect(PivotSql, SqlClient.SqlClient);

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
