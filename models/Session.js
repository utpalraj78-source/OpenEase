// PostgreSQL-backed Session Model
const { createModel } = require('../config/pgModel');
const { getPostgresClient } = require('../config/postgres');
const { overlaps } = require('../utility/helpers');

const methods = {
  isSeatAvailable() {
    return Number(this.bookedSeats || 0) < Number(this.allocatedCapacity || 0);
  },

  async incrementBookedSeats() {
    const pg = await getPostgresClient();
    const id = String(this._id);

    // Atomic conditional SQL update in PostgreSQL with zero race conditions
    const res = await pg.query(
      `UPDATE sessions 
       SET booked_seats = booked_seats + 1,
           doc = jsonb_set(doc, '{bookedSeats}', to_jsonb((doc->>'bookedSeats')::int + 1)),
           updated_at = NOW()
       WHERE id = $1 AND (doc->>'bookedSeats')::int < (doc->>'allocatedCapacity')::int
       RETURNING doc;`,
      [id]
    );

    if (res.rows && res.rows.length > 0) {
      const d = typeof res.rows[0].doc === 'string' ? JSON.parse(res.rows[0].doc) : res.rows[0].doc;
      this.bookedSeats = d.bookedSeats;
      this._doc.bookedSeats = d.bookedSeats;
      return true;
    }
    return false;
  },

  async decrementBookedSeats() {
    const pg = await getPostgresClient();
    const id = String(this._id);
    const res = await pg.query(
      `UPDATE sessions 
       SET booked_seats = GREATEST(0, booked_seats - 1),
           doc = jsonb_set(doc, '{bookedSeats}', to_jsonb(GREATEST(0, (doc->>'bookedSeats')::int - 1))),
           updated_at = NOW()
       WHERE id = $1 AND (doc->>'bookedSeats')::int > 0
       RETURNING doc;`,
      [id]
    );
    if (res.rows && res.rows.length > 0) {
      const d = typeof res.rows[0].doc === 'string' ? JSON.parse(res.rows[0].doc) : res.rows[0].doc;
      this.bookedSeats = d.bookedSeats;
      this._doc.bookedSeats = d.bookedSeats;
    }
  },

  checkTimeCollision(start, end) {
    return overlaps(start, end, this.startTime, this.endTime);
  }
};

const virtuals = {
  seatsLeft: {
    get() {
      return Math.max(0, (Number(this.allocatedCapacity) || 0) - (Number(this.bookedSeats) || 0));
    }
  }
};

const Session = createModel('sessions', methods, {}, virtuals, {
  bookedSeats: 0
});

module.exports = Session;
