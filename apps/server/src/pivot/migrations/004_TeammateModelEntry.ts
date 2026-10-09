import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The named teammate model a teammate was dispatched on, from Settings.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN model_entry TEXT`;
});
