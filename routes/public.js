const express = require('express');
const Event = require('../models/Event');
const Session = require('../models/Session');
const EventCategory = require('../models/EventCategory');
const Registration = require('../models/Registration');
const registrationPolicy = require('../services/registrationPolicyService');
const { generateEventIcs } = require('../utility/calendarHelper');
const ServiceError = require('../utility/errors');
const { requireRole } = require('../middleware/auth');
const { PROGRAMS } = require('../config/constants');
const { homeFor } = require('./auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    if (req.user && req.user.role !== 'STUDENT_PARENT') return res.redirect(homeFor(req.user));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = await Event.find({ status: 'PUBLISHED', 'schedule.eventDate': { $gte: today } })
      .populate('category', 'categoryName').populate('venue', 'buildingName roomNumber')
      .sort({ 'schedule.eventDate': 1 }).limit(3);
    const categories = await EventCategory.find().sort({ categoryName: 1 });
    res.render('home', { title: 'Open House', upcoming, categories, fullBleed: true });
  } catch (err) { next(err); }
});

// FR-016..FR-018 listing, search, filter (StudentParent.browseEvents)
router.get('/events', async (req, res, next) => {
  try {
    const { events, categories } = await registrationPolicy.browseEvents(req.query);

    // seats taken per event + whether this user already registered
    const ids = events.map(e => e._id);
    const counts = await Registration.aggregate([
      { $match: { event: { $in: ids }, status: 'REGISTERED' } },
      { $group: { _id: '$event', n: { $sum: 1 } } }
    ]);
    const countMap = Object.fromEntries(counts.map(c => [String(c._id), c.n]));
    let mine = {};
    if (req.user) {
      const regs = await Registration.find({ participant: req.user._id, event: { $in: ids }, status: 'REGISTERED' }).select('event');
      mine = Object.fromEntries(regs.map(r => [String(r.event), true]));
    }
    res.render('events/list', { title: 'Open house events', events, categories, countMap, mine });
  } catch (err) { next(err); }
});

// FR-019, FR-020, FR-033
router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('category', 'categoryName').populate('venue')
      .populate('coordinator', 'fullName role department');
    const isStaff = req.user && req.user.role !== 'STUDENT_PARENT';
    if (!event || (!['PUBLISHED', 'CANCELLED'].includes(event.status) && !isStaff)) {
      return res.status(404).render('error', { title: 'Event not found', message: 'This event is not available.' });
    }
    const sessions = await Session.find({ event: event._id }).populate('venue').sort({ startTime: 1 });
    const confirmed = await event.calculateTotalBookings();
    let myReg = null;
    if (req.user) {
      myReg = await Registration.findOne({ participant: req.user._id, event: event._id, status: 'REGISTERED' })
        .populate('session', 'sessionTitle startTime');
    }
    res.render('events/detail', { title: event.title, event, sessions, confirmed, myReg });
  } catch (err) { next(err); }
});

// Campus Calendar Sync Engine (Figure 50.1 - RFC 5545 .ics calendar feed)
router.get('/events/:id/calendar.ics', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate('venue').populate('category');
    if (!event) return res.status(404).send('Event not found');
    const ics = generateEventIcs(event);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${event.eventId || 'event'}.ics"`);
    res.send(ics);
  } catch (err) { next(err); }
});

async function loadRegisterPage(req, res, extra = {}) {
  const event = await Event.findById(req.params.id).populate('venue').populate('category', 'categoryName');
  if (!event || event.status !== 'PUBLISHED') {
    return res.status(404).render('error', { title: 'Event not found', message: 'This event is not open for registration.' });
  }
  const existing = await Registration.findOne({ participant: req.user._id, event: event._id, status: 'REGISTERED' });
  if (existing) {
    req.flash('info', 'You are already registered for this event.');
    return res.redirect(`/my/registrations/${existing._id}`);
  }
  const sessions = await Session.find({ event: event._id }).populate('venue').sort({ startTime: 1 });
  const eligible = registrationPolicy.checkEligibility(event, req.user);
  res.status(extra.status || 200).render('events/register', {
    title: `Register - ${event.title}`, event, sessions, eligible, programs: PROGRAMS,
    form: extra.form || null, error: extra.error, errorList: extra.errorList
  });
}

// UI-02
router.get('/events/:id/register', requireRole('STUDENT_PARENT'), async (req, res, next) => {
  try { await loadRegisterPage(req, res); } catch (err) { next(err); }
});

router.post('/events/:id/register', requireRole('STUDENT_PARENT'), async (req, res, next) => {
  const b = req.body;
  const ticked = v => v === 'on' || v === 'true';
  try {
    const reg = await req.user.registerForEvent(req.params.id, b.sessionId, {
      fullName: b.fullName, email: b.email, contactPhone: b.contactPhone, participantType: b.participantType,
      currentInstitution: b.currentInstitution, intendedProgram: b.intendedProgram, guests: b.guests,
      eligibilityConfirmed: ticked(b.eligibilityConfirmed), termsAccepted: ticked(b.termsAccepted)
    });
    req.flash('success', `Registration confirmed. Your reference is ${reg.registrationId}.`);
    res.redirect(`/my/registrations/${reg._id}`);
  } catch (err) {
    if (err instanceof ServiceError) {
      return loadRegisterPage(req, res, {
        error: err.message, errorList: err.details, form: b, status: err.status
      }).catch(next);
    }
    next(err);
  }
});

module.exports = router;
