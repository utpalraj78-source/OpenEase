// REST api, same names as the interfaces in sec 51.3 of our doc
// uses the same session cookie as the website so in postman hit /api/v1/auth/login first
const express = require('express');
const User = require('../models/User');
const Event = require('../models/Event');
const workflow = require('../services/eventWorkflowService');
const registrationPolicy = require('../services/registrationPolicyService');
const attendanceService = require('../services/attendanceOrchestratorService');
const ServiceError = require('../utility/errors');
const { requireLogin, requireRole } = require('../middleware/auth');
const { toInputDateTime } = require('../utility/helpers');

const router = express.Router();

// wraps a handler so ServiceErrors come back as { error, message, details }
const handle = fn => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ServiceError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    next(err);
  }
};

router.post('/auth/login', handle(async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!user || !(await user.authenticate(req.body.password || '')) || user.accountStatus !== 'ACTIVE') {
    throw new ServiceError(401, 'ERR_AUTH_FAILED', 'Invalid credentials');
  }
  req.session.userId = String(user._id);
  res.json({ userId: user.getUserId(), id: user._id, fullName: user.fullName, role: user.getRole() });
}));

router.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// public listing
router.get('/events', handle(async (req, res) => {
  const events = await Event.find({ status: 'PUBLISHED' }).populate('venue', 'buildingName roomNumber')
    .sort({ 'schedule.eventDate': 1 });
  res.json(events.map(e => ({
    eventId: e.eventId, id: e._id, title: e.title, eventDate: e.schedule.eventDate,
    startTime: e.schedule.startTime, endTime: e.schedule.endTime,
    venue: e.venue && e.venue.label, totalMaxCapacity: e.totalMaxCapacity, registrationState: e.registrationState()
  })));
}));

// IEventWorkflowService

// createDraftEvent
router.post('/events/draft', requireRole('COORDINATOR', 'ADMIN'), handle(async (req, res) => {
  const d = req.body;
  const body = {
    title: d.title, description: d.description, category: d.categoryId, eventDate: d.eventDate,
    startTime: (d.startTime || '').slice(0, 5), endTime: (d.endTime || '').slice(0, 5),
    venue: d.mainVenueId, totalMaxCapacity: d.totalMaxCapacity || d.totalCapacity, organizer: d.organizer,
    registrationStart: d.registrationWindow && toInputDateTime(d.registrationWindow.startDate),
    registrationEnd: d.registrationWindow && toInputDateTime(d.registrationWindow.endDate),
    criteriaId: d.criteriaId || d.eligibility || 'GENERAL_PUBLIC', criteriaDescription: d.eligibilityDescription
  };
  const event = await workflow.saveEvent({ user: req.user, body, action: 'draft' });
  res.status(201).json({ eventId: event.eventId, id: event._id, status: event.status, createdTimestamp: event.createdAt });
}));

// addSessionsToEvent
router.post('/events/:id/sessions', requireRole('COORDINATOR', 'ADMIN'), handle(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const { event, created } = await workflow.addSessions(req.params.id, req.user, list);
  res.json({ eventId: event.eventId, sessionsCreated: created.length });
}));

// submitEventForApproval
router.put('/events/:id/submit', requireRole('COORDINATOR', 'ADMIN'), handle(async (req, res) => {
  const event = await workflow.submitExisting(req.params.id, req.user);
  res.json({ eventId: event.eventId, status: event.status, approverRole: 'EVENT_APPROVER' });
}));

// IRegistrationService

router.post('/registrations/enroll', requireRole('STUDENT_PARENT'), handle(async (req, res) => {
  const b = req.body;
  const yes = v => v === true || v === 'true';
  const reg = await req.user.registerForEvent(b.eventId, b.sessionId, {
    fullName: b.fullName, email: b.email, contactPhone: b.contactPhone, participantType: b.participantType,
    currentInstitution: b.currentInstitution, intendedProgram: b.intendedProgram, guests: b.guests,
    eligibilityConfirmed: yes(b.eligibilityConfirmed), termsAccepted: yes(b.termsAccepted)
  });
  res.status(201).json({
    registrationId: reg.registrationId, id: reg._id, eventId: String(reg.event), sessionId: String(reg.session),
    status: reg.status, timestamp: reg.registrationTimestamp
  });
}));

router.delete('/registrations/:id', requireLogin, handle(async (req, res) => {
  const reg = await registrationPolicy.cancel({ user: req.user, registrationId: req.params.id, reason: req.query.reason });
  res.json({ registrationId: reg.registrationId, status: reg.status, seatReleased: true });
}));

// IAttendanceService

router.get('/sessions/:id/roster', requireRole('COORDINATOR', 'ADMIN'), handle(async (req, res) => {
  const { session, participants } = await attendanceService.getRoster(req.params.id, req.user);
  res.json({
    sessionId: session.sessionId,
    allocatedCapacity: session.allocatedCapacity,
    totalBooked: session.bookedSeats,
    participants: participants.map(p => ({
      registrationId: p.registrationId, code: p.code, participantName: p.name,
      participantType: p.type, currentStatus: p.status, checkInTimestamp: p.checkInTimestamp
    }))
  });
}));

router.post('/attendance/batch-record', requireRole('COORDINATOR', 'ADMIN'), handle(async (req, res) => {
  const { sessionId, rosterRecords } = req.body;
  if (!Array.isArray(rosterRecords)) throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'rosterRecords must be an array');
  const result = await attendanceService.recordBatch(sessionId, req.user, rosterRecords);
  res.json(result);
}));

module.exports = router;
