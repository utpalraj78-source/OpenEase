require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const getPgSessionStore = require('./config/sessionStore');
const { getPostgresClient } = require('./config/postgres');
const flash = require('./middleware/flash');
const { loadUser } = require('./middleware/auth');
const helpers = require('./utility/helpers');
const C = require('./config/constants');

const PORT = process.env.PORT || 3000;

function buildApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(session({
    name: 'openease.sid',
    secret: process.env.SESSION_SECRET || 'change-this-in-.env',
    resave: false,
    saveUninitialized: false,
    store: getPgSessionStore(),
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  }));

  app.use(flash);
  app.use(loadUser);

  // things every template can use
  app.use((req, res, next) => {
    res.locals.h = helpers;
    res.locals.C = C;
    res.locals.path = req.path;
    res.locals.query = req.query;
    next();
  });

  app.use(require('./middleware/showcase').showcaseGuard);
  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/public'));
  app.use('/my', require('./routes/student'));
  app.use('/coordinator', require('./routes/coordinator'));
  app.use('/approver', require('./routes/approver'));
  app.use('/reports', require('./routes/reports'));
  app.use('/admin', require('./routes/admin'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/api/v1', require('./routes/api'));

  app.use((req, res) => {
    if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ error: 'ERR_NOT_FOUND' });
    res.status(404).render('404', { title: 'Page not found' });
  });

  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.originalUrl}]`, err.stack || err);
    if (res.headersSent) return next(err);
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(500).json({ error: 'ERR_INTERNAL', message: 'Something went wrong on the server.' });
    }
    res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again. If it keeps happening, contact the administrator.' });
  });

  return app;
}

if (require.main === module) {
  getPostgresClient()
    .then(() => {
      console.log('[db] PostgreSQL database connection verified.');
      buildApp().listen(PORT, () => console.log(`[web] OpenEase running on PostgreSQL at http://localhost:${PORT}`));
    })
    .catch(err => {
      console.error('[db] could not connect to PostgreSQL:', err.message);
      process.exit(1);
    });
}

module.exports = buildApp;
