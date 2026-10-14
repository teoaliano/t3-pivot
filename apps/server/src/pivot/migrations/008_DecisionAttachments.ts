import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // JSON array of the images the user attached to the answer. Null when none.
  yield* sql`ALTER TABLE pivot_decisions ADD COLUMN user_attachments_json TEXT`;
});
