// tier 4: Registration repository (RegistrationDAO). the seat "lock" itself is
// Session.incrementBookedSeats() - one atomic conditional update instead of a row lock
const Registration = require('../models/Registration');

module.exports = {
  findById: id => Registration.findById(id),
  findByIdFull: id => Registration.findById(id).populate('event').populate('session'),
  // an earlier attempt that failed validation, reused on "correct and resubmit"
  findOpenAttempt: (participantId, eventId) => Registration.findOne({
    participant: participantId, event: eventId, status: { $in: ['PENDING_VALIDATION', 'CORRECTION_REQUIRED'] }
  }),
  newRegistration: data => new Registration(data),
  save: reg => reg.save(),
  listForParticipant: participantId => Registration.find({
    participant: participantId, status: { $in: ['REGISTERED', 'CANCELLED'] }
  }).populate({ path: 'event', populate: { path: 'venue', select: 'buildingName roomNumber' } })
    .populate('session').sort({ createdAt: -1 }),
  findRegisteredBySession: sessionId => Registration.find({ session: sessionId, status: 'REGISTERED' })
    .populate('participant', 'fullName email').sort({ registrationTimestamp: 1 }),
  findByIds: ids => Registration.find({ _id: { $in: ids } }),
  cancelAllForEvent: eventId => Registration.updateMany({ event: eventId, status: 'REGISTERED' },
    { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Event cancelled by institute' })
};
