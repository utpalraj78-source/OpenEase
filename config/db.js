// OpenEase Database Connection
// Now permanently backed by PostgreSQL (Hybrid Embedded PGlite + External PostgreSQL Pool)
const { getPostgresClient } = require('./postgres');

async function connectDB() {
  const client = await getPostgresClient();
  console.log('[db] connected to PostgreSQL database engine.');
  return client;
}

module.exports = connectDB;
