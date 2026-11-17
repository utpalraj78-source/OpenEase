// OpenEase - PostgreSQL Session Store Configuration
const session = require('express-session');
const PgSimple = require('connect-pg-simple')(session);
const { getPostgresClient } = require('./postgres');

let storeInstance = null;

function getPgSessionStore() {
  if (storeInstance) return storeInstance;

  storeInstance = new PgSimple({
    pool: {
      query: async (sql, params) => {
        const client = await getPostgresClient();
        return client.query(sql, params);
      }
    },
    tableName: 'session',
    createTableIfMissing: false
  });

  return storeInstance;
}

module.exports = getPgSessionStore;
