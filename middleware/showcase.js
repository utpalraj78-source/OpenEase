// All core and secondary use cases are now fully operational.
// Out-of-scope items (e.g. online payments, live streaming, QR attendance) remain out of scope.
const SHOWCASE_ACTIONS = [];

const WORKING = 'All in-scope workflows (event creation, approval, publishing, registration, cancellation, attendance, feedback, reports, and user management) are active.';

function showcaseGuard(req, res, next) {
  const hit = SHOWCASE_ACTIONS.find(a => a.method === req.method && a.re.test(req.path));
  if (!hit) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(501).json({ error: 'ERR_SHOWCASE_ONLY', message: `${hit.label} is showcase only.` });
  }
  req.flash('info', `Showcase only: ${hit.label}. ${WORKING}`);
  const back = req.get('Referer');
  res.redirect(back && back.startsWith(`${req.protocol}://${req.get('host')}`) ? back : '/');
}

module.exports = { showcaseGuard, SHOWCASE_ACTIONS };
