// PostgreSQL-backed Counter Model
const { createModel } = require('../config/pgModel');

const Counter = createModel('counters', {}, {}, {}, {
  seq: 0
});

const START = {
  EVT: 1000, SES: 100, REG: 480000, USR: 1000, PAR: 2000,
  COO: 3000, APR: 4000, SCH: 1000, VAL: 0, ATT: 700000,
  CAT: 0, VEN: 0, FDB: 1000
};

async function nextCode(prefix) {
  const doc = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true }
  );
  return `${prefix}-${(START[prefix] || 0) + doc.seq}`;
}

module.exports = { Counter, nextCode };
