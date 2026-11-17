// tier 4: Event & Session repository (EventDAO / SessionDAO)
// all event/session/venue database calls from the services go through here
const Event = require('../models/Event');
const Session = require('../models/Session');
const Venue = require('../models/Venue');

module.exports = {
  findEventById: id => Event.findById(id),
  newEvent: data => new Event(data),
  saveEvent: event => event.save(),
  findPendingEvents: () => Event.find({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } })
    .populate('coordinator', 'fullName role department').populate('category', 'categoryName')
    .sort({ updatedAt: 1 }),

  findSessionsByEvent: eventId => Session.find({ event: eventId }).sort({ startTime: 1 }),
  findSessionById: id => Session.findById(id),
  findSessionWithEvent: id => Session.findById(id).populate('event').populate('venue'),
  createSession: data => Session.create(data),
  saveSession: s => s.save(),
  deleteSession: s => s.deleteOne(),
  resetSeats: eventId => Session.updateMany({ event: eventId }, { bookedSeats: 0 }),

  findVenueById: id => Venue.findById(id),
  findVenuesByIds: ids => Venue.find({ _id: { $in: ids } })
};
