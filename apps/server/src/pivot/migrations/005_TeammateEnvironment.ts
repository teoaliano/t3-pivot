import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The environment that hosts the teammate. Null is the Pivot's own environment.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN environment_id TEXT`;
});
