// PostgreSQL-backed Venue Model
const { createModel, getRegisteredModel } = require('../config/pgModel');
const { overlaps } = require('../utility/helpers');

const methods = {
  verifyCapacity(requiredSeats) {
    return this.isOperational && requiredSeats <= this.seatingCapacity;
  },

  async checkAvailability(date, start, end, ignore = {}) {
    const Event = getRegisteredModel('events');
    const Session = getRegisteredModel('sessions');

    const sameDay = await Event.find({
      'schedule.eventDate': date,
      _id: { $ne: ignore.eventId },
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).select('_id title venue schedule');

    for (const ev of sameDay) {
      if (ev.venue && String(ev.venue._id || ev.venue) === String(this._id) &&
          overlaps(start, end, ev.schedule.startTime, ev.schedule.endTime)) {
        return { available: false, clashWith: ev.title };
      }
    }

    const sessions = await Session.find({
      event: { $in: sameDay.map(e => e._id) },
      venue: this._id,
      _id: { $nin: ignore.sessionIds || [] }
    }).populate('event', 'title');

    for (const s of sessions) {
      if (s.checkTimeCollision(start, end)) {
        return { available: false, clashWith: `${s.event ? s.event.title : 'Session'} (${s.sessionTitle})` };
      }
    }
    return { available: true };
  }
};

const virtuals = {
  label: {
    get() {
      return `${this.roomNumber}, ${this.buildingName}`;
    }
  }
};

const Venue = createModel('venues', methods, {}, virtuals, {
  isOperational: true,
  hasProjector: false
});

module.exports = Venue;
