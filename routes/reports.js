const express = require('express');
const Event = require('../models/Event');
const reports = require('../services/reportingService');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('COORDINATOR', 'ADMIN', 'MANAGEMENT'));

// BR-010: coordinators see their own events, management/admin see everything
router.get('/', async (req, res, next) => {
  try {
    const filter = { status: { $in: ['PUBLISHED', 'CANCELLED'] } };
    if (req.user.role === 'COORDINATOR') filter.coordinator = req.user._id;
    const rows = await reports.eventSummaries(filter);
    const totals = rows.reduce((t, r) => {
      t.confirmed += r.confirmed; t.present += r.present; t.cancelled += r.cancelled; return t;
    }, { confirmed: 0, present: 0, cancelled: 0 });
    res.render('reports/index', { title: 'Reports', rows, totals });
  } catch (err) { next(err); }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event || (req.user.role === 'COORDINATOR' && String(event.coordinator) !== String(req.user._id))) {
      return res.status(404).render('error', { title: 'Not found', message: 'Report not available.' });
    }
    const [summary] = await reports.eventSummaries({ _id: event._id });
    const sessions = await reports.sessionBreakdown(event._id);
    const feedback = await reports.feedbackSummary(event._id);
    res.render('reports/event', { title: `Report - ${event.title}`, s: summary, sessions, feedback });
  } catch (err) { next(err); }
});

module.exports = router;
