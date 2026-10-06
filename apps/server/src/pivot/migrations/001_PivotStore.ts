import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The log. Projections below are derived from it in the same transaction.
  // `wakes` marks an event the owning Pivot should be woken for; ownership is
  // read through the teammate or decision it names, so a takeover moves it.
  yield* sql`
    CREATE TABLE pivot_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      pivot_thread_id TEXT,
      teammate_thread_id TEXT,
      decision_id TEXT,
      wakes INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_pivot_events_teammate ON pivot_events(teammate_thread_id, sequence)`;
  yield* sql`CREATE INDEX idx_pivot_events_decision ON pivot_events(decision_id, sequence)`;
  yield* sql`CREATE INDEX idx_pivot_events_wakes ON pivot_events(wakes, sequence)`;

  yield* sql`
    CREATE TABLE pivot_pivots (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      home_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retired_at TEXT,
      successor_thread_id TEXT,
      wake_cursor INTEGER NOT NULL,
      wake_from INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_pivot_pivots_active_project
    ON pivot_pivots(project_id) WHERE retired_at IS NULL
  `;

  yield* sql`
    CREATE TABLE pivot_teammates (
      thread_id TEXT PRIMARY KEY,
      pivot_thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      delivery_mode TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      spec TEXT NOT NULL,
      report_json TEXT,
      resume TEXT,
      scout_report TEXT,
      dispatched_at TEXT NOT NULL,
      torn_down_at TEXT,
      observed_status TEXT,
      observed_run_id TEXT,
      stopped_run_id TEXT,
      stuck_run_id TEXT,
      recheck_at TEXT,
      merge_requested_url TEXT
    )
  `;
  yield* sql`CREATE INDEX idx_pivot_teammates_pivot ON pivot_teammates(pivot_thread_id, dispatched_at)`;

  yield* sql`
    CREATE TABLE pivot_decisions (
      decision_id TEXT PRIMARY KEY,
      pivot_thread_id TEXT NOT NULL,
      teammate_thread_id TEXT,
      key TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      summary TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      escalation_json TEXT,
      escalated_at TEXT,
      user_answer TEXT,
      user_answered_at TEXT,
      resolution_json TEXT,
      closed_at TEXT
    )
  `;
  yield* sql`CREATE INDEX idx_pivot_decisions_pivot ON pivot_decisions(pivot_thread_id, closed_at)`;
  yield* sql`CREATE INDEX idx_pivot_decisions_teammate ON pivot_decisions(teammate_thread_id)`;
});
