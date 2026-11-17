const express = require('express');
const Notification = require('../models/Notification');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', async (req, res, next) => {
  try {
    const items = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.render('notifications', { title: 'Notifications', items });
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, notificationStatus: 'UNREAD' }, { notificationStatus: 'READ' });
    res.redirect('/notifications');
  } catch (err) { next(err); }
});

// open = mark as read then follow the link
router.get('/:id/open', async (req, res, next) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id }, { notificationStatus: 'READ' }, { new: true });
    res.redirect(n && n.link ? n.link : '/notifications');
  } catch (err) { next(err); }
});

module.exports = router;
