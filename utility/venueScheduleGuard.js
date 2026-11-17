// tier 3: Venue & Schedule Guard (room collision detector)
// the event workflow asks this before saving anything that books a room
const Venue = require('../models/Venue');
const { toMinutes, overlaps } = require('./helpers');

const DAY_START = toMinutes('08:00');
const DAY_END = toMinutes('20:00');

// is the room free? returns the clashing event/session title or null
async function findClash(venueId, date, start, end, ignore = {}) {
  const venue = await Venue.findById(venueId);
  if (!venue) return null;
  const res = await venue.checkAvailability(date, start, end, ignore);
  return res.available ? null : res.clashWith;
}

// two sessions of the same event in the same room at the same time
function internalClashes(sessions) {
  const out = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (a.venue && String(a.venue) === String(b.venue) && a.startTime && b.startTime &&
          overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) {
        out.push(`"${a.sessionTitle}" and "${b.sessionTitle}" overlap in the same room.`);
      }
    }
  }
  return out;
}

// event hours rule (08:00 - 20:00)
function withinCampusHours(start, end) {
  return toMinutes(start) >= DAY_START && toMinutes(end) <= DAY_END;
}

module.exports = { findClash, internalClashes, withinCampusHours };
