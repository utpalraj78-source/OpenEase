const express = require('express');
const Event = require('../models/Event');
const Session = require('../models/Session');
const ServiceError = require('../utility/errors');
const workflow = require('../services/eventWorkflowService');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('APPROVER', 'ADMIN'));

// review queue + recent decisions (UC-004, showcase only)
router.get('/', async (req, res, next) => {
  try {
    const pending = await workflow.pendingSubmissions();
    const decided = await Event.find({ 'reviews.reviewer': req.user._id, status: { $nin: ['SUBMITTED', 'UNDER_REVIEW'] } })
      .populate('coordinator', 'fullName').sort({ updatedAt: -1 }).limit(15);
    res.render('approver/queue', { title: 'Review queue', pending, decided });
  } catch (err) { next(err); }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    // showcase only: the review screen is read-only in this prototype (no status change)
    const event = await Event.findById(req.params.id)
      .populate('coordinator', 'fullName email role department').populate('category', 'categoryName')
      .populate('venue').populate('reviews.reviewer', 'fullName');
    if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
    const sessions = await Session.find({ event: event._id }).populate('venue').sort({ startTime: 1 });
    res.render('approver/review', { title: `Review - ${event.title}`, event, sessions });
  } catch (err) { next(err); }
});

router.post('/events/:id/decision', async (req, res, next) => {
  try {
    const d = req.body.decision;
    const u = req.user;
    const ev = d === 'APPROVED' ? await u.approveEvent(req.params.id, req.body.comments)
      : d === 'REJECTED' ? await u.rejectEvent(req.params.id, req.body.comments)
        : await u.requestRevision(req.params.id, req.body.comments);
    const word = { APPROVED: 'approved', REJECTED: 'rejected', REVISION_REQUIRED: 'sent back for changes' }[ev.status];
    req.flash('success', `${ev.eventId} ${word}. The coordinator has been notified.`);
    res.redirect('/approver');
  } catch (err) {
    if (!(err instanceof ServiceError)) return next(err);
    req.flash('error', err.message);
    res.redirect(`/approver/events/${req.params.id}`);
  }
});

module.exports = router;
