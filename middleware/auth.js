const User = require('../models/User');
const Notification = require('../models/Notification');

// loads logged in user on every request so views can use currentUser
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;
  if (!req.session.userId) return next();
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.accountStatus !== 'ACTIVE') {
      req.session.userId = null;
      return next();
    }
    req.user = user;
    res.locals.currentUser = user;
    res.locals.unreadCount = await Notification.countDocuments({ recipient: user._id, notificationStatus: 'UNREAD' });
    next();
  } catch (err) {
    next(err);
  }
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/');
}

// NFR-004: protected functionality requires authentication
function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) {
    return res.status(401).json({ error: 'ERR_AUTH_REQUIRED', message: 'Login required' });
  }
  req.session.returnTo = req.originalUrl;
  req.flash('info', 'Please log in to continue.');
  res.redirect('/login');
}

// FR-005 / NFR-005: role based access
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    if (wantsJson(req)) {
      return res.status(403).json({ error: 'ERR_INSUFFICIENT_PRIVILEGES', message: 'Your role cannot do this' });
    }
    res.status(403).render('error', {
      title: 'Access denied',
      message: 'You do not have permission to open this page.'
    });
  };
}

module.exports = { loadUser, requireLogin, requireRole };
