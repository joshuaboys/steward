export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS steward (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    autonomy TEXT NOT NULL,
    application_id TEXT NOT NULL,
    config_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    payload_json TEXT,
    disposition TEXT,
    run_id TEXT
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    trigger_event_id TEXT,
    application_id TEXT NOT NULL,
    status TEXT NOT NULL,
    disposition TEXT,
    execution_class TEXT NOT NULL,
    workflow_instance_id TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    budget_json TEXT,
    usage_json TEXT,
    waiting_for TEXT,
    preconditions_json TEXT
);

CREATE TABLE IF NOT EXISTS facts (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    source_event_id TEXT,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beliefs (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    evidence_id TEXT,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    request_digest TEXT,
    response_digest TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    action_json TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS watchers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    cursor_json TEXT,
    last_checked_at TEXT,
    next_check_at TEXT
);

CREATE TABLE IF NOT EXISTS wait_subscriptions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    workflow_instance_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    transport_type TEXT NOT NULL,
    matcher_json TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    specification TEXT NOT NULL,
    event_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    event TEXT NOT NULL,
    run_id TEXT,
    event_id TEXT,
    workflow_instance_id TEXT,
    application_id TEXT,
    detail TEXT,
    data_json TEXT
);
`;

export const SCHEMA_STATEMENTS = SCHEMA_SQL.split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => `${s};`);
