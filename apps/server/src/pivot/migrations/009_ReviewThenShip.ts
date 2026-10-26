import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // When the teammate was told to push and open its PR. Null while its work waits for review.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN ship_ordered_at TEXT`;
  // The Pivot's review of the teammate's latest done; its next report clears it.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN verdict_json TEXT`;
  // For a scout: the project checkout's changed files when it started, to compare its report against.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN checkout_snapshot_json TEXT`;
  // A hosted teammate the home dispatched to ship directly; batches never reach a host.
  yield* sql`ALTER TABLE pivot_hosted_teammates ADD COLUMN ship_ordered_at TEXT`;
});
