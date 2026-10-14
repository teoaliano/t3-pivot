import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Why the teammate's agent is waiting to start, while it waits for memory. Null otherwise.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN memory_wait TEXT`;
});
