// tier 4: Attendance repository (AttendanceDAO / roster)
const Attendance = require('../models/Attendance');

module.exports = {
  findBySession: sessionId => Attendance.find({ session: sessionId }),
  findByRegistrations: ids => Attendance.find({ registration: { $in: ids } }),
  newAttendance: data => new Attendance(data),
  save: a => a.save(),
  deleteByRegistration: regId => Attendance.deleteOne({ registration: regId })
};
