import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // 1 approved, 0 declined, null when the decision did not ask for approval.
  yield* sql`ALTER TABLE pivot_decisions ADD COLUMN user_approved INTEGER`;
});
