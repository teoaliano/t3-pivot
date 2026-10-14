import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // What a Pivot on another environment (its home) may do here. A host link's sessions have
  // the subject `pivot-host:<grant_id>` and carry no allowlist: it is read from this row on
  // every call, so an edit or a revoke reaches sessions that are already open. Revoking
  // empties the allowlist and the bound home but keeps the row, so the subject stays refused.
  yield* sql`
    CREATE TABLE pivot_host_grants (
      grant_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      allowed_project_ids TEXT NOT NULL,
      bound_home_environment_id TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `;

  // The teammates this environment runs for a grant's home, keyed by V2 thread id. A grant
  // owns a record only through grant_id; the dispatch_id the home chose makes a retried
  // launch find its teammate again instead of starting a second.
  yield* sql`
    CREATE TABLE pivot_hosted_teammates (
      thread_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES pivot_host_grants(grant_id),
      dispatch_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      pivot_thread_id TEXT NOT NULL,
      pivot_label TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      delivery_mode TEXT NOT NULL,
      first_run_id TEXT,
      created_at TEXT NOT NULL,
      torn_down_at TEXT,
      UNIQUE (grant_id, dispatch_id)
    )
  `;

  // What happened to hosted teammates, in order, for the home to replay from a cursor.
  yield* sql`
    CREATE TABLE pivot_hosted_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      grant_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_pivot_hosted_events_grant ON pivot_hosted_events(grant_id, sequence)`;
});
