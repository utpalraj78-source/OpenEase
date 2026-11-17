const { getPostgresClient } = require('../config/postgres');

const SCHEMA_SQL = `
DROP TABLE IF EXISTS "session" CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS registrations CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS event_reviews CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS venues CASCADE;
DROP TABLE IF EXISTS event_categories CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS counters CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(32),
    email VARCHAR(160) UNIQUE,
    role VARCHAR(32),
    account_status VARCHAR(32) DEFAULT 'ACTIVE',
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_categories (
    id VARCHAR(64) PRIMARY KEY,
    category_id VARCHAR(32),
    category_name VARCHAR(120),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venues (
    id VARCHAR(64) PRIMARY KEY,
    venue_id VARCHAR(32),
    building_name VARCHAR(120),
    room_number VARCHAR(60),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(32),
    title VARCHAR(200),
    status VARCHAR(32),
    coordinator_id VARCHAR(64),
    venue_id VARCHAR(64),
    category_id VARCHAR(64),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(32),
    event_id VARCHAR(64),
    session_title VARCHAR(200),
    allocated_capacity INTEGER DEFAULT 0,
    booked_seats INTEGER DEFAULT 0,
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
    id VARCHAR(64) PRIMARY KEY,
    registration_id VARCHAR(32),
    event_id VARCHAR(64),
    session_id VARCHAR(64),
    participant_id VARCHAR(64),
    email VARCHAR(160),
    status VARCHAR(32),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
    id VARCHAR(64) PRIMARY KEY,
    attendance_id VARCHAR(32),
    event_id VARCHAR(64),
    session_id VARCHAR(64),
    participant_id VARCHAR(64),
    registration_id VARCHAR(64),
    status VARCHAR(32),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
    id VARCHAR(64) PRIMARY KEY,
    feedback_id VARCHAR(32),
    event_id VARCHAR(64),
    participant_id VARCHAR(64),
    registration_id VARCHAR(64),
    rating INTEGER,
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64),
    action VARCHAR(64),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    recipient_id VARCHAR(64),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registration_validations (
    id VARCHAR(64) PRIMARY KEY,
    validation_id VARCHAR(32),
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS counters (
    id VARCHAR(64) PRIMARY KEY,
    seq INTEGER DEFAULT 0,
    doc JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL PRIMARY KEY,
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

async function init() {
  const db = await getPostgresClient();
  if (db.exec) {
    await db.exec(SCHEMA_SQL);
  } else {
    await db.query(SCHEMA_SQL);
  }
  console.log('PostgreSQL schema initialized successfully!');
  return db;
}

if (require.main === module) {
  init().catch(err => {
    console.error('Schema initialization failed:', err);
    process.exit(1);
  });
}

module.exports = { init, SCHEMA_SQL };
