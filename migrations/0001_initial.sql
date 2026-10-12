PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  daily_goal_minutes INTEGER NOT NULL DEFAULT 20 CHECK (daily_goal_minutes > 0),
  inactivity_threshold_seconds INTEGER NOT NULL DEFAULT 20 CHECK (inactivity_threshold_seconds >= 5),
  required_weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  local_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  credited_ms INTEGER NOT NULL DEFAULT 0 CHECK (credited_ms >= 0),
  correction_ms INTEGER NOT NULL DEFAULT 0,
  correction_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','complete','abandoned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS practice_sessions_child_date ON practice_sessions(child_id, local_date);

CREATE TABLE IF NOT EXISTS detection_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('listening','playing','grace','paused','unavailable','ended')),
  confidence REAL,
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS detection_events_session_time ON detection_events(session_id, at_ms);

CREATE TABLE IF NOT EXISTS point_rules (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  points INTEGER NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(child_id, rule_key)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  points INTEGER NOT NULL CHECK (points <> 0),
  kind TEXT NOT NULL,
  source_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS point_ledger_child_time ON point_ledger(child_id, created_at);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  week_start TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(child_id, week_start)
);

CREATE TABLE IF NOT EXISTS excused_days (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(child_id, local_date)
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  point_cost INTEGER NOT NULL CHECK(point_cost > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  restrictions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  cost INTEGER NOT NULL CHECK(cost > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS parent_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
