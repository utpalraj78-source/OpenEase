// PostgreSQL-backed User Model with Role Discriminators
const bcrypt = require('bcryptjs');
const { createModel } = require('../config/pgModel');
const { ROLES } = require('../config/constants');

const svc = name => require(`../services/${name}`);

const methods = {
  authenticate(rawPassword) {
    return bcrypt.compare(rawPassword || '', this.passwordHash || '');
  },

  getUserId() {
    return this.userId;
  },

  getRole() {
    return this.role;
  },

  async updatePassword(oldPassword, newPassword) {
    if (!(await this.authenticate(oldPassword))) return false;
    this.passwordHash = await bcrypt.hash(newPassword, 10);
    this._doc.passwordHash = this.passwordHash;
    await this.save();
    return true;
  },

  // Student / Parent methods
  browseEvents(filter) {
    return svc('registrationPolicyService').browseEvents(filter || {});
  },

  registerForEvent(eventId, sessionId, details) {
    return svc('registrationPolicyService').register({ user: this, eventId, sessionId, ...details });
  },

  cancelRegistration(registrationId, reason) {
    return svc('registrationPolicyService').cancel({ user: this, registrationId, reason });
  },

  viewMyRegistrations() {
    return svc('registrationPolicyService').listFor(this);
  },

  // Coordinator methods
  createEvent(dto, action = 'draft') {
    return svc('eventWorkflowService').saveEvent({ user: this, body: dto, action });
  },

  updateEvent(eventId, dto, action = 'draft') {
    return svc('eventWorkflowService').saveEvent({ user: this, eventId, body: dto, action });
  },

  submitEventForReview(eventId) {
    return svc('eventWorkflowService').submitExisting(eventId, this);
  },

  addSessionToEvent(eventId, sessionDTO) {
    return svc('eventWorkflowService').addSessions(eventId, this, [sessionDTO]);
  },

  recordSessionAttendance(sessionId, batch) {
    return svc('attendanceOrchestratorService').recordBatch(sessionId, this, batch);
  },

  // Approver methods
  getPendingSubmissions() {
    return svc('eventWorkflowService').pendingSubmissions();
  },

  approveEvent(eventId, comments) {
    return svc('eventWorkflowService').decide(eventId, this, 'APPROVED', comments);
  },

  rejectEvent(eventId, reason) {
    return svc('eventWorkflowService').decide(eventId, this, 'REJECTED', reason);
  },

  requestRevision(eventId, notes) {
    return svc('eventWorkflowService').decide(eventId, this, 'REVISION_REQUIRED', notes);
  }
};

const statics = {
  hashPassword(plain) {
    return bcrypt.hash(plain, 10);
  }
};

const virtuals = {
  isStaff: {
    get() {
      return this.role !== ROLES.STUDENT_PARENT;
    }
  }
};

const User = createModel('users', methods, statics, virtuals, {
  accountStatus: 'ACTIVE'
});

// Create role-specific models inheriting from User
class StudentParent extends User {
  constructor(data = {}) {
    super({ role: ROLES.STUDENT_PARENT, ...data });
    this.role = ROLES.STUDENT_PARENT;
    this._doc.role = ROLES.STUDENT_PARENT;
  }
}
class EventCoordinator extends User {
  constructor(data = {}) {
    super({ role: ROLES.COORDINATOR, ...data });
    this.role = ROLES.COORDINATOR;
    this._doc.role = ROLES.COORDINATOR;
  }
}
class EventApprover extends User {
  constructor(data = {}) {
    super({ role: ROLES.APPROVER, ...data });
    this.role = ROLES.APPROVER;
    this._doc.role = ROLES.APPROVER;
  }
}
class Administrator extends User {
  constructor(data = {}) {
    super({ role: ROLES.ADMIN, ...data });
    this.role = ROLES.ADMIN;
    this._doc.role = ROLES.ADMIN;
  }
}
class InstituteManagement extends User {
  constructor(data = {}) {
    super({ role: ROLES.MANAGEMENT, ...data });
    this.role = ROLES.MANAGEMENT;
    this._doc.role = ROLES.MANAGEMENT;
  }
}

// Add static create helper for each subclass
for (const Sub of [StudentParent, EventCoordinator, EventApprover, Administrator, InstituteManagement]) {
  Sub.create = async function(data) {
    if (Array.isArray(data)) {
      const arr = [];
      for (const d of data) arr.push(await Sub.create(d));
      return arr;
    }
    const inst = new Sub(data);
    await inst.save();
    return inst;
  };
}

// Discriminator hydration hook on User
const origHydrate = User.hydrate;
User.hydrate = function(data) {
  let inst;
  switch (data.role) {
    case ROLES.COORDINATOR:
      inst = new EventCoordinator(data);
      break;
    case ROLES.STUDENT_PARENT:
      inst = new StudentParent(data);
      break;
    case ROLES.APPROVER:
      inst = new EventApprover(data);
      break;
    case ROLES.ADMIN:
      inst = new Administrator(data);
      break;
    case ROLES.MANAGEMENT:
      inst = new InstituteManagement(data);
      break;
    default:
      inst = origHydrate(data);
      break;
  }
  inst._isNew = false;
  return inst;
};

User.StudentParent = StudentParent;
User.EventCoordinator = EventCoordinator;
User.EventApprover = EventApprover;
User.Administrator = Administrator;
User.InstituteManagement = InstituteManagement;

module.exports = User;
