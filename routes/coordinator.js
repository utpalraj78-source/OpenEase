const express = require('express');
const Event = require('../models/Event');
const Session = require('../models/Session');
const EventCategory = require('../models/EventCategory');
const Venue = require('../models/Venue');
const Registration = require('../models/Registration');
const workflow = require('../services/eventWorkflowService');
const attendanceService = require('../services/attendanceOrchestratorService');
const ServiceError = require('../utility/errors');
const { requireRole } = require('../middleware/auth');
const { EDITABLE_STATUSES } = require('../config/constants');

const router = express.Router();
router.use(requireRole('COORDINATOR', 'ADMIN'));

function ownFilter(user) {
  return user.role === 'ADMIN' ? {} : { coordinator: user._id };
}

// coordinators go through their own class methods (EventCoordinator.createEvent etc),
// admin doesn't have those so it calls the service straight
function saveFor(user, eventId, body, action) {
  if (user.createEvent) {
    return eventId ? user.updateEvent(eventId, body, action) : user.createEvent(body, action);
  }
  return workflow.saveEvent({ user, eventId, body, action });
}

async function formOptions() {
  const [categories, venues] = await Promise.all([
    EventCategory.find().sort({ categoryName: 1 }),
    Venue.find({ isOperational: true }).sort({ buildingName: 1, roomNumber: 1 })
  ]);
  return { categories, venues };
}

// dashboard: my events grouped by status
router.get('/', async (req, res, next) => {
  try {
    const events = await Event.find(ownFilter(req.user)).populate('venue', 'buildingName roomNumber')
      .sort({ 'schedule.eventDate': 1 });
    const counts = await Registration.aggregate([
      { $match: { event: { $in: events.map(e => e._id) }, status: 'REGISTERED' } },
      { $group: { _id: '$event', n: { $sum: 1 } } }
    ]);
    const countMap = Object.fromEntries(counts.map(c => [String(c._id), c.n]));
    res.render('coordinator/dashboard', { title: 'My events', events, countMap });
  } catch (err) { next(err); }
});

// sidebar "My Events": every event as one flat list
router.get('/events', async (req, res, next) => {
  try {
    const events = await Event.find(ownFilter(req.user)).populate('venue', 'buildingName roomNumber')
      .populate('category', 'categoryName').sort({ updatedAt: -1 });
    res.render('coordinator/my-events', { title: 'My events', events });
  } catch (err) { next(err); }
});

// sidebar "Attendance": every session of my published events
router.get('/attendance', async (req, res, next) => {
  try {
    const events = await Event.find({ ...ownFilter(req.user), status: 'PUBLISHED' }).sort({ 'schedule.eventDate': 1 });
    const sessions = await Session.find({ event: { $in: events.map(e => e._id) } })
      .populate('venue', 'buildingName roomNumber').sort({ startTime: 1 });
    const byEvent = events.map(e => ({ event: e, sessions: sessions.filter(s => String(s.event) === String(e._id)) }));
    res.render('coordinator/attendance-index', { title: 'Attendance', byEvent });
  } catch (err) { next(err); }
});

// UI-01 create
router.get('/events/new', async (req, res, next) => {
  try {
    res.render('coordinator/event-form', {
      title: 'Create event', event: null, form: {}, sessions: [], errors: null, ...(await formOptions())
    });
  } catch (err) { next(err); }
});

router.post('/events', async (req, res, next) => {
  const action = req.body.action === 'submit' ? 'submit' : 'draft';
  try {
    const event = await saveFor(req.user, null, req.body, action);
    req.flash('success', action === 'submit'
      ? `${event.eventId} submitted for approval.`
      : `Draft ${event.eventId} saved.`);
    res.redirect(action === 'submit' ? '/coordinator' : `/coordinator/events/${event._id}/edit`);
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    res.status(err.status).render('coordinator/event-form', {
      title: 'Create event', event: null, form: req.body,
      sessions: workflow.normaliseSessionsInput(req.body),
      errors: err.details || [err.message], ...(await formOptions())
    });
  }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, ...ownFilter(req.user) })
      .populate('category', 'categoryName').populate('venue').populate('reviews.reviewer', 'fullName');
    if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
    const sessions = await Session.find({ event: event._id }).populate('venue').sort({ startTime: 1 });
    const registrations = await Registration.find({ event: event._id, status: { $in: ['REGISTERED', 'CANCELLED'] } })
      .populate('session', 'sessionTitle').sort({ createdAt: -1 });
    res.render('coordinator/event-detail', {
      title: event.title, event, sessions, registrations, canEdit: EDITABLE_STATUSES.includes(event.status)
    });
  } catch (err) { next(err); }
});

router.get('/events/:id/edit', async (req, res, next) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, ...ownFilter(req.user) });
    if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
    if (!EDITABLE_STATUSES.includes(event.status)) {
      req.flash('error', 'This event cannot be edited in its current status.');
      return res.redirect(`/coordinator/events/${event._id}`);
    }
    const sessions = await Session.find({ event: event._id }).sort({ startTime: 1 });
    res.render('coordinator/event-form', {
      title: 'Edit event', event, form: null, sessions, errors: null, ...(await formOptions())
    });
  } catch (err) { next(err); }
});

router.post('/events/:id', async (req, res, next) => {
  const action = req.body.action === 'submit' ? 'submit' : 'draft';
  try {
    const event = await saveFor(req.user, req.params.id, req.body, action);
    if (event.status === 'PUBLISHED') req.flash('success', 'Changes saved. Registered participants were notified if the schedule changed.');
    else if (action === 'submit') req.flash('success', event.status === 'UNDER_REVIEW' ? `${event.eventId} resubmitted for review.` : `${event.eventId} submitted for approval.`);
    else req.flash('success', 'Draft saved.');
    res.redirect(action === 'submit' || event.status === 'PUBLISHED' ? `/coordinator/events/${event._id}` : `/coordinator/events/${event._id}/edit`);
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    const event = await Event.findById(req.params.id);
    res.status(err.status).render('coordinator/event-form', {
      title: 'Edit event', event, form: req.body,
      sessions: workflow.normaliseSessionsInput(req.body),
      errors: err.details || [err.message], ...(await formOptions())
    });
  }
});

// same try catch for publish/cancel/remind so i dont repeat it 3 times
function action(fn, okMsg) {
  return async (req, res, next) => {
    try {
      const out = await fn(req);
      req.flash('success', typeof okMsg === 'function' ? okMsg(out) : okMsg);
    } catch (err) {
      if (!(err instanceof ServiceError)) return next(err);
      req.flash('error', err.message);
    }
    res.redirect(`/coordinator/events/${req.params.id}`);
  };
}

router.post('/events/:id/publish', action(req => workflow.publish(req.params.id, req.user), 'Event published. Students can now register.'));
router.post('/events/:id/cancel', action(req => workflow.cancel(req.params.id, req.user, req.body.reason), 'Event cancelled. Registered participants have been notified.'));
router.post('/events/:id/remind', action(req => workflow.sendReminder(req.params.id, req.user), n => `Reminder sent to ${n} participant(s).`));

// CSV of participants (showcase only)
router.get('/events/:id/participants.csv', async (req, res, next) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, ...ownFilter(req.user) });
    if (!event) return res.status(404).send('Not found');
    const regs = await Registration.find({ event: event._id, status: 'REGISTERED' }).populate('session', 'sessionTitle startTime');
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Reg ID', 'Name', 'Email', 'Phone', 'Type', 'Institution', 'Session', 'Time', 'Guests']];
    regs.forEach(r => rows.push([
      r.registrationId, r.fullName, r.email, r.contactPhone, r.participantType, r.currentInstitution,
      r.session && r.session.sessionTitle, r.session && r.session.startTime, r.guests
    ]));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${event.eventId}-participants.csv"`);
    res.send(rows.map(r => r.map(esc).join(',')).join('\n'));
  } catch (err) { next(err); }
});

// UI-03 attendance terminal (UC-012)
router.get('/sessions/:sessionId/attendance', async (req, res, next) => {
  try {
    const { session, participants } = await attendanceService.getRoster(req.params.sessionId, req.user);
    const siblings = await Session.find({ event: session.event._id }).sort({ startTime: 1 }).select('sessionTitle startTime');
    res.render('coordinator/attendance', { title: `Attendance - ${session.sessionTitle}`, session, participants, siblings });
  } catch (err) {
    if (err instanceof ServiceError) {
      return res.status(err.status).render('error', { title: 'Attendance', message: err.message });
    }
    next(err);
  }
});

// form posts status[<registrationId>] = PRESENT|ABSENT|PENDING
router.post('/sessions/:sessionId/attendance', async (req, res, next) => {
  try {
    const statuses = req.body.status || {};
    const records = Object.keys(statuses).map(id => ({ registrationId: id, status: statuses[id] }));
    const result = req.user.recordSessionAttendance
      ? await req.user.recordSessionAttendance(req.params.sessionId, records)
      : await attendanceService.recordBatch(req.params.sessionId, req.user, records);
    if (result.failedRecords) {
      req.flash('error', `${result.failedRecords} row(s) were skipped: ${result.failures[0].reason}`);
    }
    req.flash('success', `Attendance successfully recorded for ${result.processedRecords} participants.`);
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    req.flash('error', err.message);
  }
  res.redirect(`/coordinator/sessions/${req.params.sessionId}/attendance`);
});

module.exports = router;
