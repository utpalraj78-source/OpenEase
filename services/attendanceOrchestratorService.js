// tier 2: AttendanceOrchestratorService (UC-012 check-in tracker) - FR-029 to FR-032, BR-008
// follows collaboration diagram 42.3: select session -> getRegisteredParticipants ->
// validateParticipant -> associate event + session -> attendance recorded status
const eventRepo = require('../repositories/eventSessionRepository');
const regRepo = require('../repositories/registrationRepository');
const repo = require('../repositories/attendanceRepository');
const dispatcher = require('../utility/auditAlertDispatcher');
const ServiceError = require('../utility/errors');
const { nextCode } = require('../models/Counter');

function canRecord(user, event) {
  if (user.role === 'ADMIN') return true;
  return user.role === 'COORDINATOR' && String(event.coordinator) === String(user._id);
}

// 3-4: selectSession + getRegisteredParticipants
async function getRoster(sessionId, user) {
  const session = await eventRepo.findSessionWithEvent(sessionId);
  if (!session) throw new ServiceError(404, 'ERR_SESSION_NOT_FOUND', 'Session does not exist.');
  if (!canRecord(user, session.event)) {
    throw new ServiceError(403, 'ERR_INSUFFICIENT_PRIVILEGES', 'Access Denied: You do not have permissions to record attendance for this session.');
  }
  const regs = await regRepo.findRegisteredBySession(session._id);
  const marks = await repo.findBySession(session._id);
  const byReg = Object.fromEntries(marks.map(m => [String(m.registration), m]));

  const participants = regs.map(r => {
    const m = byReg[String(r._id)];
    return {
      registrationId: String(r._id),
      code: r.registrationId,
      name: r.fullName || (r.participant ? r.participant.fullName : '(deleted user)'),
      email: r.email || (r.participant ? r.participant.email : ''),
      type: r.participantType,
      institution: r.currentInstitution || '',
      guests: r.guests,
      status: m ? m.status : 'PENDING',
      checkInTimestamp: m ? m.checkInTimestamp : null
    };
  });
  return { session, participants };
}

// 5: recordAttendance for the whole roster in one go
// records: [{ registrationId, status: PRESENT|ABSENT|PENDING }]
// TODO: QR check in later? (out of scope in the doc for now)
async function recordBatch(sessionId, user, records) {
  const session = await eventRepo.findSessionWithEvent(sessionId);
  if (!session) throw new ServiceError(404, 'ERR_SESSION_NOT_FOUND', 'Session does not exist.');
  if (!canRecord(user, session.event)) {
    throw new ServiceError(403, 'ERR_INSUFFICIENT_PRIVILEGES', 'Access Denied: You do not have permissions to record attendance for this session.');
  }
  if (session.event.status !== 'PUBLISHED') {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'Attendance can only be recorded for published events.');
  }
  const eventDay = new Date(session.event.schedule.eventDate);
  eventDay.setHours(0, 0, 0, 0);
  if (new Date() < eventDay) {
    throw new ServiceError(409, 'ERR_TOO_EARLY', 'Attendance opens on the day of the event.');
  }

  // 5.1 validateParticipant - check every row first so one bad row doesn't leave half a batch saved
  const regs = await regRepo.findByIds(records.map(r => r.registrationId));
  const regMap = Object.fromEntries(regs.map(r => [String(r._id), r]));
  const failures = [];
  const valid = [];
  for (const rec of records) {
    const reg = regMap[rec.registrationId];
    if (!reg || String(reg.session) !== String(session._id) || reg.status !== 'REGISTERED') {
      failures.push({ registrationId: rec.registrationId, reason: 'Participant ID not found in the verified roster for this session.' });
      continue;
    }
    if (!['PRESENT', 'ABSENT', 'PENDING'].includes(rec.status)) {
      failures.push({ registrationId: rec.registrationId, reason: 'Attendance status must be provided.' });
      continue;
    }
    valid.push({ rec, reg });
  }

  // 5.2-5.3 associate event + session, then markPresent / markAbsent
  const existing = await repo.findByRegistrations(valid.map(v => v.reg._id));
  const byReg = Object.fromEntries(existing.map(a => [String(a.registration), a]));
  for (const { rec, reg } of valid) {
    let att = byReg[String(reg._id)];
    if (rec.status === 'PENDING') {                       // "Reset" button
      if (att) await repo.deleteByRegistration(reg._id);
      continue;
    }
    if (!att) {
      att = repo.newAttendance({
        attendanceId: await nextCode('ATT'), registration: reg._id,
        event: session.event._id, session: session._id, participant: reg.participant, status: rec.status
      });
    }
    if (rec.status === 'PRESENT') att.markPresent(user._id);
    else att.markAbsent(user._id);
    await repo.save(att);
  }

  const now = new Date();
  await dispatcher.log(user._id, 'ATTENDANCE_BATCH_COMMITTED', session.sessionId, `processed ${valid.length}, failed ${failures.length}`);
  // 5.4 attendance recorded status
  return { sessionId: String(session._id), processedRecords: valid.length, failedRecords: failures.length, failures, auditTimestamp: now };
}

module.exports = { getRoster, recordBatch, canRecord };
