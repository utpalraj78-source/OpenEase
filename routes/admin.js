const express = require('express');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { nextCode } = require('../models/Counter');
const ldap = require('../services/ldapService');
const dispatcher = require('../utility/auditAlertDispatcher');
const ServiceError = require('../utility/errors');
const { requireRole } = require('../middleware/auth');
const { ROLES, LEVEL_LABELS } = require('../config/constants');
const { escapeRegex } = require('../utility/helpers');

const router = express.Router();
router.use(requireRole('ADMIN'));

// Dashboard & User List (UC-002, FR-004, FR-005, FR-045)
router.get('/', (req, res) => res.redirect('/admin/users'));

// Peer-level Syslog Stream & LDAP Integration Status (Figure 50.1)
router.get('/syslog', (req, res) => {
  const syslogLines = dispatcher.getRecentSyslog(100);
  const ldapStatus = ldap.getDirectoryStatus();
  res.render('admin/syslog', {
    title: 'Syslog Stream & Directory Status',
    syslogLines,
    ldapStatus
  });
});

router.get('/users', async (req, res, next) => {
  try {
    const { q, role, status } = req.query;
    const filter = {};
    if (q && q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim()), 'i');
      filter.$or = [{ fullName: rx }, { email: rx }, { userId: rx }];
    }
    if (role && Object.values(ROLES).includes(role)) {
      filter.role = role;
    }
    if (status && ['ACTIVE', 'DISABLED'].includes(status)) {
      filter.accountStatus = status;
    }

    const [users, roleStats, statusStats, recentLogs] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: '$accountStatus', count: { $sum: 1 } } }]),
      AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'fullName email')
    ]);

    const stats = {
      total: users.length,
      byRole: Object.fromEntries(roleStats.map(r => [r._id, r.count])),
      active: (statusStats.find(s => s._id === 'ACTIVE') || {}).count || 0,
      disabled: (statusStats.find(s => s._id === 'DISABLED') || {}).count || 0
    };

    res.render('admin/users', {
      title: 'User Management',
      users,
      stats,
      recentLogs,
      query: { q, role, status },
      roles: ROLES
    });
  } catch (err) { next(err); }
});

router.get('/users/new', (req, res) => {
  res.render('admin/user-form', {
    title: 'Create User',
    userObj: null,
    form: {},
    errors: null,
    roles: ROLES,
    levels: LEVEL_LABELS
  });
});

router.post('/users', async (req, res, next) => {
  const form = req.body;
  const errors = [];
  try {
    const email = (form.email || '').trim().toLowerCase();
    const fullName = (form.fullName || '').trim();
    const role = form.role;

    if (!fullName || fullName.length < 2) errors.push('Full name must be at least 2 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
    if (!form.password || form.password.length < 8) errors.push('Password must be at least 8 characters.');
    if (!Object.values(ROLES).includes(role)) errors.push('Invalid role selected.');
    if (email && await User.exists({ email })) errors.push('An account with this email already exists.');

    if (errors.length) {
      return res.status(400).render('admin/user-form', {
        title: 'Create User',
        userObj: null,
        form,
        errors,
        roles: ROLES,
        levels: LEVEL_LABELS
      });
    }

    const common = {
      userId: await nextCode('USR'),
      fullName,
      email,
      passwordHash: await User.hashPassword(form.password),
      accountStatus: form.accountStatus || 'ACTIVE'
    };

    let newUser;
    switch (role) {
      case ROLES.STUDENT_PARENT:
        newUser = await User.StudentParent.create({
          ...common,
          participantId: await nextCode('PAR'),
          participantType: form.participantType || 'STUDENT',
          contactPhone: form.contactPhone || undefined,
          currentInstitution: (form.currentInstitution || '').trim(),
          eligibilityStatus: form.eligibilityStatus || 'OTHER'
        });
        break;
      case ROLES.COORDINATOR:
        newUser = await User.EventCoordinator.create({
          ...common,
          coordinatorId: await nextCode('COO'),
          department: (form.department || '').trim(),
          officeRoom: (form.officeRoom || '').trim()
        });
        break;
      case ROLES.APPROVER:
        newUser = await User.EventApprover.create({
          ...common,
          approverId: await nextCode('APR'),
          departmentScope: (form.department || '').trim(),
          administrativeRank: (form.administrativeRank || 'Faculty Approver').trim()
        });
        break;
      case ROLES.MANAGEMENT:
        newUser = await User.InstituteManagement.create({
          ...common,
          department: (form.department || 'Institute Leadership').trim()
        });
        break;
      case ROLES.ADMIN:
        newUser = await User.Administrator.create({
          ...common,
          department: (form.department || 'System Administration').trim()
        });
        break;
    }

    await dispatcher.log(req.user._id, 'ADMIN_CREATE_USER', newUser.email, `Role: ${role}`);
    req.flash('success', `User account ${newUser.email} (${role}) created successfully.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.get('/users/:id/edit', async (req, res, next) => {
  try {
    const userObj = await User.findById(req.params.id);
    if (!userObj) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
    res.render('admin/user-form', {
      title: `Edit User - ${userObj.fullName}`,
      userObj,
      form: null,
      errors: null,
      roles: ROLES,
      levels: LEVEL_LABELS
    });
  } catch (err) { next(err); }
});

router.post('/users/:id', async (req, res, next) => {
  const form = req.body;
  const errors = [];
  try {
    const userObj = await User.findById(req.params.id);
    if (!userObj) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });

    const email = (form.email || '').trim().toLowerCase();
    const fullName = (form.fullName || '').trim();

    if (!fullName || fullName.length < 2) errors.push('Full name must be at least 2 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
    if (email !== userObj.email && await User.exists({ email })) {
      errors.push('Another account with this email already exists.');
    }

    if (errors.length) {
      return res.status(400).render('admin/user-form', {
        title: `Edit User - ${userObj.fullName}`,
        userObj,
        form,
        errors,
        roles: ROLES,
        levels: LEVEL_LABELS
      });
    }

    userObj.fullName = fullName;
    userObj.email = email;
    userObj.accountStatus = form.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
    if (userObj.role === 'COORDINATOR' || userObj.role === 'APPROVER' || userObj.role === 'MANAGEMENT' || userObj.role === 'ADMIN') {
      userObj.department = (form.department || '').trim();
    }
    if (userObj.role === 'COORDINATOR') {
      userObj.officeRoom = (form.officeRoom || '').trim();
    }

    // Role reassignment if changed (FR-004)
    if (form.role && form.role !== userObj.role && Object.values(ROLES).includes(form.role)) {
      userObj.role = form.role;
    }

    await userObj.save();
    await dispatcher.log(req.user._id, 'ADMIN_UPDATE_USER', userObj.email, `Status: ${userObj.accountStatus}`);
    req.flash('success', `User account ${userObj.email} updated.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/toggle-status', async (req, res, next) => {
  try {
    const userObj = await User.findById(req.params.id);
    if (!userObj) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
    if (String(userObj._id) === String(req.user._id)) {
      req.flash('error', 'You cannot disable your own administrator account.');
      return res.redirect('/admin/users');
    }
    userObj.accountStatus = userObj.accountStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await userObj.save();
    await dispatcher.log(req.user._id, 'ADMIN_TOGGLE_STATUS', userObj.email, `New status: ${userObj.accountStatus}`);
    req.flash('success', `Account ${userObj.email} is now ${userObj.accountStatus.toLowerCase()}.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const userObj = await User.findById(req.params.id);
    if (!userObj) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
    const newPass = (req.body.newPassword || '').trim();
    if (!newPass || newPass.length < 8) {
      req.flash('error', 'New password must be at least 8 characters.');
      return res.redirect(`/admin/users/${userObj._id}/edit`);
    }
    userObj.passwordHash = await User.hashPassword(newPass);
    await userObj.save();
    await dispatcher.log(req.user._id, 'ADMIN_RESET_PASSWORD', userObj.email);
    req.flash('success', `Password for ${userObj.email} has been reset.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

module.exports = router;
