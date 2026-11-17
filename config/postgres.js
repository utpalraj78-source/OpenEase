// OpenEase - PostgreSQL Database Connection Provider
// Supports:
// 1. External PostgreSQL server via pg (when PGHOST/DATABASE_URL is set)
// 2. Embedded in-process PostgreSQL via @electric-sql/pglite (zero-config, runs anywhere)

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PGlite } = require('@electric-sql/pglite');

let pgClient = null;
let isEmbedded = false;

async function getPostgresClient() {
  if (pgClient) return pgClient;

  const connectionString = process.env.DATABASE_URL || process.env.PG_URI;
  if (connectionString || process.env.PGHOST) {
    const pool = new Pool({
      connectionString: connectionString || undefined,
      host: process.env.PGHOST || '127.0.0.1',
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'openease'
    });
    pgClient = pool;
    isEmbedded = false;
  } else {
    // In-memory or file-backed PGlite instance
    const dataDir = process.env.PG_DATA_DIR || path.join(__dirname, '..', 'data', 'pglite');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    pgClient = new PGlite(dataDir);
    isEmbedded = true;
  }

  return pgClient;
}

async function initPostgresSchema() {
  const db = await getPostgresClient();
  const schemaPath = path.join(__dirname, '..', 'docs', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  if (isEmbedded) {
    await db.exec(sql);
  } else {
    await db.query(sql);
  }
  return { isEmbedded };
}

module.exports = {
  getPostgresClient,
  initPostgresSchema,
  isEmbedded: () => isEmbedded
};
