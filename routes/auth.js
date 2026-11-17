const express = require('express');
const User = require('../models/User');
const ldap = require('../services/ldapService');
const dispatcher = require('../utility/auditAlertDispatcher');
const { nextCode } = require('../models/Counter');
const { requireLogin } = require('../middleware/auth');
const { LEVEL_LABELS } = require('../config/constants');

const router = express.Router();

function homeFor(user) {
  switch (user.role) {
    case 'COORDINATOR': return '/coordinator';
    case 'APPROVER': return '/approver';
    case 'ADMIN': return '/admin/users';
    case 'MANAGEMENT': return '/reports';
    default: return '/events';
  }
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  res.render('auth/login', { title: 'Log in', email: '' });
});

// FR-001 / FR-002
router.post('/login', async (req, res, next) => {
  try {
    const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      if (req.accepts('html') && !req.xhr && !req.headers['content-type']?.includes('application/json')) {
        return res.status(401).render('auth/login', { title: 'Log in', email, error: 'Invalid email or password.' });
      }
      return res.status(401).json({ error: 'ERR_INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }
    const user = await User.findOne({ email });
    const ok = user && await user.authenticate(password);

    if (!ok) {
      // Check Institutional LDAP Directory (Figure 50.1 Subordinate System)
      const ldapProfile = await ldap.authenticateLdap(email, password);
      if (ldapProfile) {
        const ldapUser = await ldap.findOrCreateLdapUser(ldapProfile);
        const returnTo = req.session.returnTo;
        return req.session.regenerate(err => {
          if (err) return next(err);
          req.session.userId = String(ldapUser._id);
          req.session.authMethod = 'LDAP';
          const back = returnTo || homeFor(ldapUser);
          res.redirect(back.startsWith('/') ? back : '/');
        });
      }

      return res.status(401).render('auth/login', {
        title: 'Log in', email, error: 'Incorrect email or password.'
      });
    }
    if (user.accountStatus !== 'ACTIVE') {
      return res.status(403).render('auth/login', {
        title: 'Log in', email, error: 'This account has been disabled. Contact the administrator.'
      });
    }
    const returnTo = req.session.returnTo;
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = String(user._id);
      user.lastLoginAt = new Date();
      user.save().catch(() => {});
      const back = returnTo || homeFor(user);
      res.redirect(back.startsWith('/') ? back : '/');
    });
  } catch (err) { next(err); }
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/events');
  res.render('auth/register', { title: 'Create account', form: {}, levels: LEVEL_LABELS });
});

// self sign-up is only for students/parents. Staff accounts are created by the admin.
router.post('/register', async (req, res, next) => {
  const form = req.body;
  const errors = [];
  try {
    const email = (form.email || '').trim().toLowerCase();
    if (!form.fullName || form.fullName.trim().length < 2) errors.push('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
    if (form.contactPhone && !/^\d{10}$/.test(form.contactPhone)) errors.push('Mobile number must be 10 digits.');
    if (!form.password || form.password.length < 8) errors.push('Password must be at least 8 characters.');
    if (form.password !== form.confirm) errors.push('Passwords do not match.');
    if (!['STUDENT', 'PARENT'].includes(form.participantType)) errors.push('Tell us if you are a student or a parent.');
    if (email && await User.exists({ email })) errors.push('An account with this email already exists.');

    if (errors.length) {
      return res.status(400).render('auth/register', { title: 'Create account', form, errors, levels: LEVEL_LABELS });
    }
    const user = await User.StudentParent.create({
      userId: await nextCode('USR'),
      participantId: await nextCode('PAR'),
      fullName: form.fullName.trim(),
      email,
      contactPhone: form.contactPhone || undefined,
      passwordHash: await User.hashPassword(form.password),
      participantType: form.participantType,
      eligibilityStatus: LEVEL_LABELS[form.eligibilityStatus] ? form.eligibilityStatus : 'OTHER',
      currentInstitution: (form.currentInstitution || '').trim()
    });
    await dispatcher.log(user._id, 'SELF_REGISTER', user.email);
    req.session.userId = String(user._id);
    req.flash('success', `Welcome, ${user.fullName.split(' ')[0]}! Your account is ready.`);
    res.redirect('/events');
  } catch (err) { next(err); }
});

// FR-003
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('openease.sid');
    res.redirect('/login');
  });
});

module.exports = router;
module.exports.homeFor = homeFor;
