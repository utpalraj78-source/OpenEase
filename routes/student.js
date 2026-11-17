const express = require('express');
const QRCode = require('qrcode');
const Registration = require('../models/Registration');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');
const { nextCode } = require('../models/Counter');
const { generateEventIcs } = require('../utility/calendarHelper');
const dispatcher = require('../utility/auditAlertDispatcher');
const ServiceError = require('../utility/errors');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('STUDENT_PARENT'));

// FR-027 view registration status (StudentParent.viewMyRegistrations)
router.get('/registrations', async (req, res, next) => {
  try {
    const regs = await req.user.viewMyRegistrations();
    res.render('student/registrations', { title: 'My registrations', regs });
  } catch (err) { next(err); }
});

// confirmation / booking receipt with visual 2D QR barcode
router.get('/registrations/:id', async (req, res, next) => {
  try {
    const reg = await Registration.findOne({ _id: req.params.id, participant: req.user._id })
      .populate({ path: 'event', populate: { path: 'venue' } })
      .populate({ path: 'session', populate: { path: 'venue' } });
    if (!reg) return res.status(404).render('error', { title: 'Not found', message: 'Registration not found.' });
    const attendance = await Attendance.findOne({ registration: reg._id });
    const feedback = await Feedback.findOne({ registration: reg._id });

    // Generate scannable 2D QR Barcode data URL (Category 4)
    const qrData = JSON.stringify({
      id: reg.registrationId,
      event: reg.event ? reg.event.eventId : '',
      attendee: reg.fullName || req.user.fullName,
      session: reg.session ? reg.session.sessionTitle : ''
    });
    const qrCodeUrl = await QRCode.toDataURL(qrData, { margin: 1, width: 140, color: { dark: '#0f172a', light: '#ffffff' } });

    res.render('student/registration-detail', {
      title: `Booking ${reg.registrationId}`,
      reg,
      attendance,
      feedback,
      qrCodeUrl
    });
  } catch (err) { next(err); }
});

// Campus Calendar Sync Engine (Figure 50.1 - RFC 5545 .ics download for booked session)
router.get('/registrations/:id/calendar.ics', async (req, res, next) => {
  try {
    const reg = await Registration.findOne({ _id: req.params.id, participant: req.user._id })
      .populate({ path: 'event', populate: { path: 'venue' } })
      .populate({ path: 'session', populate: { path: 'venue' } });
    if (!reg || !reg.event) return res.status(404).send('Not found');
    const ics = generateEventIcs(reg.event, reg.session);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reg.registrationId}.ics"`);
    res.send(ics);
  } catch (err) { next(err); }
});

// FR-026 cancel registration
router.post('/registrations/:id/cancel', async (req, res, next) => {
  try {
    await req.user.cancelRegistration(req.params.id, req.body.reason);
    req.flash('success', 'Your registration has been cancelled and your seat released.');
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    req.flash('error', err.message);
  }
  res.redirect(`/my/registrations/${req.params.id}`);
});

// FR-035 submit post-event feedback (BR-009)
router.post('/registrations/:id/feedback', async (req, res, next) => {
  try {
    const reg = await Registration.findOne({ _id: req.params.id, participant: req.user._id })
      .populate('event');
    if (!reg) return res.status(404).render('error', { title: 'Not found', message: 'Registration not found.' });
    if (reg.status !== 'REGISTERED') {
      throw new ServiceError(400, 'ERR_INVALID_STATUS', 'Only active registrations can submit feedback.');
    }
    const attendance = await Attendance.findOne({ registration: reg._id });
    const eventEnded = reg.event.hasEnded();
    const attended = attendance && attendance.status === 'PRESENT';
    if (!eventEnded && !attended) {
      throw new ServiceError(400, 'ERR_FEEDBACK_EARLY', 'Feedback can only be submitted after attending or after the event has concluded.');
    }
    const existing = await Feedback.findOne({ event: reg.event._id, participant: req.user._id });
    if (existing) {
      throw new ServiceError(409, 'ERR_DUPLICATE_FEEDBACK', 'You have already submitted feedback for this event.');
    }
    const rating = parseInt(req.body.rating, 10);
    if (!rating || rating < 1 || rating > 5) {
      throw new ServiceError(400, 'ERR_INVALID_RATING', 'Please provide a rating between 1 and 5 stars.');
    }
    const fb = await Feedback.create({
      feedbackId: await nextCode('FDB'),
      event: reg.event._id,
      participant: req.user._id,
      registration: reg._id,
      rating,
      comments: (req.body.comments || '').trim()
    });
    await dispatcher.log(req.user._id, 'SUBMIT_FEEDBACK', fb.feedbackId, `Rating: ${rating}`);
    req.flash('success', 'Thank you! Your feedback has been recorded.');
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    req.flash('error', err.message);
  }
  res.redirect(`/my/registrations/${req.params.id}`);
});

module.exports = router;
