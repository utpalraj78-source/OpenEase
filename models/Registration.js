// PostgreSQL-backed Registration Model
const { createModel } = require('../config/pgModel');
const { REG_STATUS } = require('../config/constants');

const methods = {
  confirmRegistration() {
    if (![REG_STATUS.PENDING_VALIDATION].includes(this.status)) return false;
    this.status = REG_STATUS.REGISTERED;
    this.registrationTimestamp = new Date();
    this._doc.status = this.status;
    this._doc.registrationTimestamp = this.registrationTimestamp;
    return true;
  },

  requireCorrection(validation) {
    this.status = REG_STATUS.CORRECTION_REQUIRED;
    if (validation) this.lastValidation = validation._id;
    this._doc.status = this.status;
    if (validation) this._doc.lastValidation = validation._id;
  },

  resubmit() {
    if (this.status === REG_STATUS.CORRECTION_REQUIRED) {
      this.status = REG_STATUS.PENDING_VALIDATION;
      this._doc.status = this.status;
    }
  },

  cancelRegistration(reason) {
    if (this.status !== REG_STATUS.REGISTERED) return false;
    this.status = REG_STATUS.CANCELLED;
    this.cancelledAt = new Date();
    this.cancelReason = (reason || '').trim() || 'Cancelled by participant';
    this._doc.status = this.status;
    this._doc.cancelledAt = this.cancelledAt;
    this._doc.cancelReason = this.cancelReason;
    return true;
  }
};

const Registration = createModel('registrations', methods, {}, {}, {
  status: REG_STATUS.PENDING_VALIDATION,
  guests: 0
});

module.exports = Registration;
