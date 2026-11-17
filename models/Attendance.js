// PostgreSQL-backed Attendance Model
const { createModel } = require('../config/pgModel');
const { ATTENDANCE_STATUS } = require('../config/constants');

const methods = {
  markPresent(coordinatorId) {
    return this.updateStatus(ATTENDANCE_STATUS.PRESENT, coordinatorId);
  },

  markAbsent(coordinatorId) {
    return this.updateStatus(ATTENDANCE_STATUS.ABSENT, coordinatorId);
  },

  updateStatus(newStatus, coordinatorId) {
    if (!Object.values(ATTENDANCE_STATUS).includes(newStatus)) return false;
    this.status = newStatus;
    this.checkInTimestamp = new Date();
    if (coordinatorId) this.recordedByUserId = coordinatorId;
    this._doc.status = this.status;
    this._doc.checkInTimestamp = this.checkInTimestamp;
    if (coordinatorId) this._doc.recordedByUserId = coordinatorId;
    return true;
  }
};

const Attendance = createModel('attendance', methods, {}, {}, {
  status: ATTENDANCE_STATUS.PENDING
});

module.exports = Attendance;
