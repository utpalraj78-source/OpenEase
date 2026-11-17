// PostgreSQL-backed Event Model
const { createModel, getRegisteredModel } = require('../config/pgModel');
const { EVENT_STATUS, CANCELLABLE_STATUSES } = require('../config/constants');

const methods = {
  isRegistrationOpen(now = new Date()) {
    const p = this.registrationPeriod || {};
    const start = p.registrationStart ? new Date(p.registrationStart) : null;
    const end = p.registrationEnd ? new Date(p.registrationEnd) : null;
    return this.status === EVENT_STATUS.PUBLISHED &&
      start && end && now >= start && now <= end;
  },

  publish() {
    if (this.status !== EVENT_STATUS.APPROVED) return false;
    this.status = EVENT_STATUS.PUBLISHED;
    this.publishedAt = new Date();
    this._doc.status = this.status;
    this._doc.publishedAt = this.publishedAt;
    return true;
  },

  cancel(reason) {
    if (!CANCELLABLE_STATUSES.includes(this.status)) return false;
    this.status = EVENT_STATUS.CANCELLED;
    this.cancelledAt = new Date();
    this.cancelReason = (reason || '').trim() || 'Cancelled by coordinator';
    this._doc.status = this.status;
    this._doc.cancelledAt = this.cancelledAt;
    this._doc.cancelReason = this.cancelReason;
    return true;
  },

  calculateTotalBookings() {
    const Registration = getRegisteredModel('registrations');
    return Registration.countDocuments({ event: this._id, status: 'REGISTERED' });
  },

  startsAt() {
    const s = this.schedule || {};
    if (!s.eventDate || !s.startTime) return null;
    const d = new Date(s.eventDate);
    const [h, m] = s.startTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  },

  endsAt() {
    const s = this.schedule || {};
    if (!s.eventDate || !s.endTime) return null;
    const d = new Date(s.eventDate);
    const [h, m] = s.endTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  },

  hasEnded(now = new Date()) {
    const end = this.endsAt();
    return !!end && now > end;
  },

  registrationState(now = new Date()) {
    const p = this.registrationPeriod || {};
    const start = p.registrationStart ? new Date(p.registrationStart) : null;
    const end = p.registrationEnd ? new Date(p.registrationEnd) : null;

    if (this.status === EVENT_STATUS.CANCELLED) return 'Cancelled';
    if (this.hasEnded(now)) return 'Event over';
    if (!start || now < start) return 'Opens soon';
    if (now > end) return 'Registration closed';
    return 'Registration open';
  }
};

const Event = createModel('events', methods, {}, {}, {
  status: EVENT_STATUS.DRAFT,
  reviews: [],
  schedule: {},
  registrationPeriod: {},
  eligibilityCriteria: {}
});

module.exports = Event;
