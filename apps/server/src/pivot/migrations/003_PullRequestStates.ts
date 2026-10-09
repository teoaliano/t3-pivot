import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The teammate's PRs as last seen, so a change made while the server was down is news.
  yield* sql`ALTER TABLE pivot_teammates ADD COLUMN pull_requests_json TEXT`;
});
