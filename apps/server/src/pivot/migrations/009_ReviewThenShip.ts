import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // When the teammate was told to push and open its PR. Null while its work waits for review.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN ship_ordered_at TEXT`;
  // A hosted teammate the home dispatched to ship directly; batches never reach a host.
  yield* sql`ALTER TABLE pivot_hosted_teammates ADD COLUMN ship_ordered_at TEXT`;
});
