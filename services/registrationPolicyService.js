// tier 2: RegistrationPolicyService (UC-009 booking orchestrator) - FR-021 to FR-028, BR-004 to BR-007
// follows collaboration diagram 42.2 and state diagram 43.2:
// submit -> PENDING_VALIDATION -> rule engine -> REGISTERED or CORRECTION_REQUIRED
//
// NOTE: local mongo has no transactions (not a replica set) so we cant do the row lock
// from the sql design. the seat is taken with Session.incrementBookedSeats(), one conditional
// update (bookedSeats < allocatedCapacity) which is atomic. if anything fails after that
// the seat is given back.
const Event = require('../models/Event');
const EventCategory = require('../models/EventCategory');
const Registration = require('../models/Registration');
const eventRepo = require('../repositories/eventSessionRepository');
const repo = require('../repositories/registrationRepository');
const ruleEngine = require('../utility/invariantRuleEngine');
const dispatcher = require('../utility/auditAlertDispatcher');
const ServiceError = require('../utility/errors');
const { nextCode } = require('../models/Counter');
const { EVENT_STATUS, LEVEL_SATISFIES } = require('../config/constants');
const { fmtDate, parseDateOnly, escapeRegex } = require('../utility/helpers');

// http status for each rule engine error
const STATUS_FOR = {
  ERR_INELIGIBLE_PARTICIPANT: 400,
  ERR_REGISTRATION_WINDOW_CLOSED: 403,
  ERR_DUPLICATE_REGISTRATION: 409,
  ERR_CAPACITY_EXCEEDED: 422
};

// quick yes/no for the register page banner (the real check is in RegistrationValidation)
function checkEligibility(event, user) {
  if (user.participantType === 'PARENT') return true;
  const ok = LEVEL_SATISFIES[user.eligibilityStatus] || ['GENERAL_PUBLIC'];
  return ok.includes((event.eligibilityCriteria && event.eligibilityCriteria.criteriaId) || 'GENERAL_PUBLIC');
}

// FR-016..FR-018 listing, search, filter
async function browseEvents({ q, category, from, to, eligibility, show } = {}) {
  const filter = { status: 'PUBLISHED' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  filter['schedule.eventDate'] = show === 'past' ? { $lt: today } : { $gte: today };

  if (q && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { organizer: rx }];
  }
  if (category) filter.category = category;
  if (eligibility) filter['eligibilityCriteria.criteriaId'] = eligibility;
  const f = parseDateOnly(from), t = parseDateOnly(to);
  if (f) filter['schedule.eventDate'] = { ...filter['schedule.eventDate'], $gte: f };
  if (t) filter['schedule.eventDate'] = { ...filter['schedule.eventDate'], $lte: t };

  const [events, categories] = await Promise.all([
    Event.find(filter).populate('category', 'categoryName').populate('venue', 'buildingName roomNumber')
      .sort({ 'schedule.eventDate': show === 'past' ? -1 : 1 }),
    EventCategory.find().sort({ categoryName: 1 })
  ]);
  return { events, categories };
}

function listFor(user) {
  return repo.listForParticipant(user._id);
}

async function register(opts) {
  const { user, eventId, sessionId } = opts;
  const details = {
    fullName: (opts.fullName || user.fullName || '').trim(),
    email: (opts.email || user.email || '').trim().toLowerCase(),
    contactPhone: (opts.contactPhone || user.contactPhone || '').trim(),
    participantType: ['STUDENT', 'PARENT'].includes(opts.participantType) ? opts.participantType : user.participantType,
    currentInstitution: (opts.currentInstitution !== undefined ? opts.currentInstitution : user.currentInstitution || '').trim(),
    intendedProgram: (opts.intendedProgram || '').trim(),
    guests: Math.min(2, Math.max(0, parseInt(opts.guests, 10) || 0)),
    eligibilityConfirmed: !!opts.eligibilityConfirmed,
    termsAccepted: !!opts.termsAccepted
  };

  // form must be complete before it can even be submitted ("data complete" guard)
  if (!eventId || !sessionId) {
    throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Please choose a session before confirming.');
  }
  if (!details.fullName || !details.email || !details.contactPhone) {
    throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Full name, email and contact number are required.');
  }
  if (!/^\d{10}$/.test(details.contactPhone)) {
    throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Contact number must be 10 digits.');
  }
  if (!details.eligibilityConfirmed) {
    throw new ServiceError(400, 'ERR_ELIGIBILITY_NOT_CONFIRMED', 'You must confirm eligibility before completing registration.');
  }
  if (!details.termsAccepted) {
    throw new ServiceError(400, 'ERR_TERMS_NOT_ACCEPTED', 'Please agree to the registration terms and attendance guidelines.');
  }

  // 1-2: event + isRegistrationOpen (the window itself is checked by the rule engine)
  const event = await eventRepo.findEventById(eventId);
  if (!event || event.status === EVENT_STATUS.CANCELLED) {
    throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'This event is not available.');
  }
  if (event.status !== EVENT_STATUS.PUBLISHED) {
    throw new ServiceError(403, 'ERR_NOT_PUBLISHED', 'This event is not open for bookings.');
  }

  // 5: selectSession
  const session = await eventRepo.findSessionById(sessionId);
  if (!session || String(session.event) !== String(event._id)) {
    throw new ServiceError(400, 'ERR_SESSION_MISMATCH', 'That session does not belong to this event.');
  }

  // BR-006: participant cannot register twice for the same event
  const alreadyRegistered = await Registration.findOne({ participant: user._id, event: event._id, status: 'REGISTERED' });
  if (alreadyRegistered) {
    throw new ServiceError(409, 'ERR_DUPLICATE_REGISTRATION', 'A registration under this account already exists for this event.');
  }

  // 3-4: createRegistration / submitRegistration -> PENDING_VALIDATION
  // an earlier failed attempt is reused ("correct and resubmit")
  let reg = await repo.findOpenAttempt(user._id, event._id);
  if (reg) {
    reg.resubmit();
  } else {
    reg = repo.newRegistration({ registrationId: await nextCode('REG'), participant: user._id, event: event._id });
  }
  Object.assign(reg, details, { session: session._id });
  await repo.save(reg);

  // 3.1-3.4: validateRegistration (eligibility, period, duplicate, capacity)
  const validation = await ruleEngine.validateRegistration(reg, user, event, session);
  if (!validation.passed) {
    reg.requireCorrection(validation);
    await repo.save(reg);
    const first = validation.validationErrors[0];
    throw new ServiceError(STATUS_FOR[first.code] || 400, first.code, first.message,
      validation.validationErrors.map(e => e.message));
  }

  // atomic seat reservation (FR-024). someone may have taken the last seat after the check
  if (!(await session.incrementBookedSeats())) {
    reg.requireCorrection(validation);
    await repo.save(reg);
    throw new ServiceError(422, 'ERR_CAPACITY_EXCEEDED', 'The selected session has reached capacity. Please choose another session.');
  }

  reg.confirmRegistration();
  try {
    await repo.save(reg);
  } catch (err) {
    await session.decrementBookedSeats();
    if (err.code === 11000) {
      // double click / two tabs, the unique index catches it
      await Registration.updateOne({ _id: reg._id }, { status: 'CORRECTION_REQUIRED' });
      throw new ServiceError(409, 'ERR_DUPLICATE_REGISTRATION', 'A registration under this account already exists for this event.');
    }
    throw err;
  }

  // 6: sendConfirmation (FR-025, FR-037)
  await dispatcher.notifyUser(user._id, 'REGISTRATION',
    `You are registered for "${event.title}" on ${fmtDate(event.schedule.eventDate)}. Session: ${session.sessionTitle} (${session.startTime}). Ref ${reg.registrationId}.`,
    `/my/registrations/${reg._id}`);
  await dispatcher.log(user._id, 'REGISTER_EVENT', reg.registrationId, event.eventId);
  return reg;
}

// FR-026: participant cancels. not allowed once the event has started (showcase only for now)
async function cancel({ user, registrationId, reason }) {
  const reg = await repo.findByIdFull(registrationId);
  if (!reg) throw new ServiceError(404, 'ERR_REG_NOT_FOUND', 'Registration not found.');
  if (String(reg.participant) !== String(user._id) && user.role !== 'ADMIN') {
    throw new ServiceError(403, 'ERR_NOT_OWNER', 'You can only cancel your own registration.');
  }
  if (reg.status === 'CANCELLED') return reg;
  const starts = reg.event.startsAt();
  if (starts && new Date() >= starts) {
    throw new ServiceError(403, 'ERR_CANCELLATION_LOCKED', 'Cancellations are disabled after the event has started.');
  }
  if (!reg.cancelRegistration(reason)) {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'Only confirmed registrations can be cancelled.');
  }
  await repo.save(reg);
  if (reg.session) await reg.session.decrementBookedSeats();
  await dispatcher.log(user._id, 'CANCEL_REGISTRATION', reg.registrationId, reg.cancelReason);
  return reg;
}

module.exports = { register, cancel, checkEligibility, browseEvents, listFor };
