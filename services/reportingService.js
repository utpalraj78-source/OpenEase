// Reporting component (read only) - basic report FR-041..044
const Event = require('../models/Event');
const Session = require('../models/Session');
const Registration = require('../models/Registration');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');

async function eventSummaries(filter = {}) {
  const events = await Event.find(filter).populate('category', 'categoryName').sort({ 'schedule.eventDate': -1 });
  const ids = events.map(e => e._id);

  const [regAgg, attAgg, feedAgg] = await Promise.all([
    Registration.aggregate([
      { $match: { event: { $in: ids } } },
      { $group: {
        _id: '$event',
        confirmed: { $sum: { $cond: [{ $eq: ['$status', 'REGISTERED'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } }
      } }
    ]),
    Attendance.aggregate([
      { $match: { event: { $in: ids } } },
      { $group: {
        _id: '$event',
        present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } }
      } }
    ]),
    Feedback.aggregate([
      { $match: { event: { $in: ids } } },
      { $group: {
        _id: '$event',
        count: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      } }
    ])
  ]);
  const R = Object.fromEntries(regAgg.map(a => [String(a._id), a]));
  const A = Object.fromEntries(attAgg.map(a => [String(a._id), a]));
  const F = Object.fromEntries(feedAgg.map(a => [String(a._id), a]));

  return events.map(e => {
    const r = R[String(e._id)] || {}, a = A[String(e._id)] || {}, f = F[String(e._id)] || {};
    const confirmed = r.confirmed || 0;
    return {
      event: e,
      confirmed,
      cancelled: r.cancelled || 0,
      fillRate: e.totalMaxCapacity ? Math.round((confirmed / e.totalMaxCapacity) * 100) : 0,
      present: a.present || 0,
      absent: a.absent || 0,
      attendanceRate: confirmed ? Math.round(((a.present || 0) / confirmed) * 100) : 0,
      feedbackCount: f.count || 0,
      avgRating: f.avgRating ? Number(f.avgRating.toFixed(1)) : null
    };
  });
}

async function sessionBreakdown(eventId) {
  const sessions = await Session.find({ event: eventId }).populate('venue', 'buildingName roomNumber').sort({ startTime: 1 });
  const att = await Attendance.aggregate([
    { $match: { session: { $in: sessions.map(s => s._id) }, status: 'PRESENT' } },
    { $group: { _id: '$session', present: { $sum: 1 } } }
  ]);
  const P = Object.fromEntries(att.map(a => [String(a._id), a.present]));
  return sessions.map(s => ({ session: s, booked: s.bookedSeats, capacity: s.allocatedCapacity, present: P[String(s._id)] || 0 }));
}

async function feedbackSummary(eventId) {
  const items = await Feedback.find({ event: eventId }).populate('participant', 'fullName participantType').sort({ createdAt: -1 });
  const count = items.length;
  const avg = count ? Number((items.reduce((s, f) => s + f.rating, 0) / count).toFixed(1)) : 0;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  items.forEach(f => {
    if (distribution[f.rating] !== undefined) distribution[f.rating]++;
  });
  return { items, count, avgRating: avg, distribution };
}

module.exports = { eventSummaries, sessionBreakdown, feedbackSummary };
