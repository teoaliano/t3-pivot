import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Inline tasks are gone. Each one an older release stored becomes an ended ship, in its
 * record and in the events that dispatched it, so every stored event still decodes. Its
 * branch stays; the shared workspace falls under the ordinary worktree cleanup rules.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE pivot_teammates
    SET kind = 'ship', torn_down_at = COALESCE(torn_down_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      recheck_at = NULL
    WHERE kind = 'inline'
  `;
  yield* sql`
    UPDATE pivot_events SET payload_json = json_set(payload_json, '$.kind', 'ship')
    WHERE type = 'teammate.dispatched' AND json_extract(payload_json, '$.kind') = 'inline'
  `;
  yield* sql`
    UPDATE pivot_hosted_teammates
    SET kind = 'ship', torn_down_at = COALESCE(torn_down_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE kind = 'inline'
  `;
});
