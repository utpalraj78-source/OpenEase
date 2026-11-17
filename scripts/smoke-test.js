// quick end to end test for UC-003, UC-009, UC-012, the business rules
// and the state diagram rules (43.1 / 43.2)
// run: npm run smoke
// uses openease_test db so it wont mess up the demo data
require('dotenv').config();
const assert = require('assert');
const seed = require('./seed');
const buildApp = require('../server');
const Event = require('../models/Event');
const Session = require('../models/Session');
const Venue = require('../models/Venue');
const EventCategory = require('../models/EventCategory');
const User = require('../models/User');
const Registration = require('../models/Registration');
const Attendance = require('../models/Attendance');
const RegistrationValidation = require('../models/RegistrationValidation');

let base;
const results = [];

// minimal cookie-keeping client on top of fetch
function client() {
  let cookie = '';
  return async function req(method, path, body, { json = false } = {}) {
    const headers = { cookie };
    let payload;
    if (body !== undefined) {
      if (json) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      else { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, location: res.headers.get('location'), data };
  };
}

async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name + ' -> ' + err.message]); }
}

function ymd(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

(async () => {
  await seed();
  const server = buildApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const coord = client(), approver = client(), student = client(), other = client(), anon = client();

  await check('FR-002 wrong password is rejected', async () => {
    const r = await anon('POST', '/login', { email: 'aarav@student.test', password: 'nope' });
    assert.strictEqual(r.status, 401);
  });

  await check('FR-001 login works for every role', async () => {
    for (const [c, email] of [[coord, 'coord.cse@openease.test'], [approver, 'approver@openease.test'],
      [student, 'aarav@student.test'], [other, 'kabir@student.test']]) {
      const r = await c('POST', '/login', { email, password: 'pass1234' });
      assert.strictEqual(r.status, 302, email);
    }
  });

  await check('CLASS user roles load as their own subclasses', async () => {
    const c = await User.findOne({ email: 'coord.cse@openease.test' });
    const st = await User.findOne({ email: 'aarav@student.test' });
    assert.ok(c instanceof User.EventCoordinator && typeof c.createEvent === 'function');
    assert.ok(st instanceof User.StudentParent && typeof st.registerForEvent === 'function');
    assert.ok(await st.authenticate('pass1234'));
  });

  await check('FR-005 student cannot open coordinator pages', async () => {
    const r = await student('GET', '/coordinator');
    assert.strictEqual(r.status, 403);
  });

  // UC-003
  const venues = await Venue.find({ isOperational: true });
  const cat = await EventCategory.findOne();
  const v = n => venues.find(x => x.roomNumber === n)._id.toString();

  const form = {
    title: 'Smoke Test Open House', description: 'Created by the smoke test', category: cat._id.toString(),
    eventDate: ymd(40), startTime: '09:00', endTime: '13:00', venue: v('Seminar Hall A'), totalMaxCapacity: '30',
    registrationStart: ymd(-1) + 'T09:00', registrationEnd: ymd(38) + 'T18:00', criteriaId: 'GENERAL_PUBLIC',
    'sessions[id][]': '', 'sessions[sessionTitle][]': 'Tiny session', 'sessions[speaker][]': '',
    'sessions[startTime][]': '10:00', 'sessions[endTime][]': '11:00', 'sessions[venue][]': v('Robotics Lab'),
    'sessions[allocatedCapacity][]': '1'
  };

  await check('UC-003 validation: end before start is rejected', async () => {
    const r = await coord('POST', '/coordinator/events', { ...form, startTime: '14:00', action: 'submit' });
    assert.strictEqual(r.status, 400);
    assert.ok(String(r.data).includes('Start time must precede end time'));
  });

  await check('UC-003 validation: session capacities > event capacity rejected', async () => {
    const r = await coord('POST', '/coordinator/events', { ...form, 'sessions[allocatedCapacity][]': '35', action: 'submit' });
    assert.strictEqual(r.status, 400);
  });

  await check('UC-003 save draft with only a title', async () => {
    const r = await coord('POST', '/coordinator/events', { title: 'Half done draft', action: 'draft' });
    assert.strictEqual(r.status, 302);
    assert.ok(await Event.findOne({ title: 'Half done draft', status: 'DRAFT' }));
  });

  let eventId;
  await check('UC-003 create and submit event -> SUBMITTED', async () => {
    const r = await coord('POST', '/coordinator/events', { ...form, action: 'submit' });
    assert.strictEqual(r.status, 302);
    const ev = await Event.findOne({ title: 'Smoke Test Open House' });
    assert.strictEqual(ev.status, 'SUBMITTED');
    assert.ok(ev.schedule.scheduleId && ev.registrationPeriod.registrationEnd && ev.eligibilityCriteria.criteriaId);
    eventId = ev._id.toString();
  });

  await check('STATE revision required -> resubmit goes to UNDER_REVIEW', async () => {
    const draft = await Event.findOne({ title: 'Half done draft' });
    // pretend the approver sent it back, then the coordinator fixes and resubmits
    draft.status = 'REVISION_REQUIRED'; await draft.save();
    const r = await coord('POST', `/coordinator/events/${draft._id}`, {
      ...form, title: 'Corrected open house', eventDate: ymd(45), registrationEnd: ymd(43) + 'T18:00',
      'sessions[startTime][]': '09:00', 'sessions[endTime][]': '09:45', action: 'submit'
    });
    assert.strictEqual(r.status, 302);
    assert.strictEqual((await Event.findById(draft._id)).status, 'UNDER_REVIEW');
  });

  await check('STATE approved event cannot be cancelled (Event.cancel)', async () => {
    const approved = await Event.findOne({ status: 'APPROVED' });
    assert.strictEqual(approved.cancel('x'), false);
    const draft = new Event({ title: 'tmp event', status: 'DRAFT' });
    assert.strictEqual(draft.cancel('x'), true);
  });

  await check('BR-004 submitted event is not visible to students', async () => {
    const r = await student('GET', `/events/${eventId}`);
    assert.strictEqual(r.status, 404);
  });

  // Real approval and publishing (UC-004 & UC-006)
  await check('UC-004 approver approves submitted event -> APPROVED', async () => {
    const r1 = await approver('GET', `/approver/events/${eventId}`);
    assert.strictEqual(r1.status, 200);
    const r2 = await approver('POST', `/approver/events/${eventId}/decision`, { decision: 'APPROVED', comments: 'Looks good to go' });
    assert.strictEqual(r2.status, 302);
    const ev = await Event.findById(eventId);
    assert.strictEqual(ev.status, 'APPROVED');
  });

  await check('UC-006 coordinator publishes approved event -> PUBLISHED', async () => {
    const r = await coord('POST', `/coordinator/events/${eventId}/publish`, {});
    assert.strictEqual(r.status, 302);
    const ev = await Event.findById(eventId);
    assert.strictEqual(ev.status, 'PUBLISHED');
    assert.ok(ev.publishedAt);
  });

  // UC-009
  const session = await Session.findOne({ event: eventId });

  await check('UC-009 both consent boxes are mandatory', async () => {
    const r = await student('POST', `/events/${eventId}/register`, { sessionId: session._id.toString(), eligibilityConfirmed: 'on' });
    assert.strictEqual(r.status, 400);
    const r2 = await student('POST', `/events/${eventId}/register`, { sessionId: session._id.toString(), termsAccepted: 'on' });
    assert.strictEqual(r2.status, 400);
  });

  let regId;
  await check('UC-009 register -> REGISTERED and seat taken', async () => {
    const r = await student('POST', `/events/${eventId}/register`, {
      sessionId: session._id.toString(), fullName: 'Aarav Patel', email: 'aarav@student.test', contactPhone: '9876500011',
      participantType: 'STUDENT', intendedProgram: 'B.Tech Computer Engineering', eligibilityConfirmed: 'on', termsAccepted: 'on'
    });
    assert.strictEqual(r.status, 302);
    regId = r.location.split('/').pop();
    const reg = await Registration.findById(regId);
    assert.strictEqual(reg.status, 'REGISTERED');
    assert.strictEqual(reg.intendedProgram, 'B.Tech Computer Engineering');
    assert.strictEqual((await Session.findById(session._id)).bookedSeats, 1);
  });

  await check('BR-006 duplicate registration blocked (API, 409)', async () => {
    const r = await student('POST', '/api/v1/registrations/enroll',
      { eventId, sessionId: session._id.toString(), eligibilityConfirmed: true, termsAccepted: true }, { json: true });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.data.error, 'ERR_DUPLICATE_REGISTRATION');
  });

  await check('BR-007 full session blocked (API, 422)', async () => {
    const r = await other('POST', '/api/v1/registrations/enroll',
      { eventId, sessionId: session._id.toString(), eligibilityConfirmed: true, termsAccepted: true }, { json: true });
    assert.strictEqual(r.status, 422);
  });

  await check('FR-022 ineligible participant blocked', async () => {
    const stem = await Event.findOne({ title: 'Engineering Open House - Day 2' });
    stem.status = 'PUBLISHED'; stem.registrationPeriod.registrationStart = new Date(Date.now() - 3600e3); await stem.save();
    const s = await Session.findOne({ event: stem._id });
    const r = await other('POST', '/api/v1/registrations/enroll',
      { eventId: stem._id.toString(), sessionId: s._id.toString(), eligibilityConfirmed: true, termsAccepted: true }, { json: true });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.data.error, 'ERR_INELIGIBLE_PARTICIPANT');
  });

  await check('STATE failed validation -> CORRECTION_REQUIRED, resubmit reuses it', async () => {
    const stem = await Event.findOne({ title: 'Engineering Open House - Day 2' });
    const kabir = await User.findOne({ email: 'kabir@student.test' });
    const attempts = await Registration.find({ participant: kabir._id, event: stem._id });
    assert.strictEqual(attempts.length, 1);
    assert.strictEqual(attempts[0].status, 'CORRECTION_REQUIRED');
    const v = await RegistrationValidation.findById(attempts[0].lastValidation);
    assert.ok(v && !v.passed && v.validationErrors[0].code === 'ERR_INELIGIBLE_PARTICIPANT');
    const s = await Session.findOne({ event: stem._id });
    await other('POST', '/api/v1/registrations/enroll',
      { eventId: stem._id.toString(), sessionId: s._id.toString(), eligibilityConfirmed: true, termsAccepted: true }, { json: true });
    assert.strictEqual(await Registration.countDocuments({ participant: kabir._id, event: stem._id }), 1);
  });

  await check('UC-010 cancel registration releases the seat (bookedSeats -> 0)', async () => {
    const r = await student('POST', `/my/registrations/${regId}/cancel`, { reason: 'Schedule conflict' });
    assert.strictEqual(r.status, 302);
    const reg = await Registration.findById(regId);
    assert.strictEqual(reg.status, 'CANCELLED');
    assert.strictEqual((await Session.findById(session._id)).bookedSeats, 0);
  });

  await check('FR-024 concurrent bookings never overbook', async () => {
    await Session.updateOne({ _id: session._id }, { allocatedCapacity: 3 });
    await Event.updateOne({ _id: eventId }, { totalMaxCapacity: 30 });
    const emails = ['riya@student.test', 'ananya@student.test', 'dev@student.test', 'ishaan@student.test', 'pooja@parent.test'];
    const clients = emails.map(() => client());
    await Promise.all(clients.map((c, i) => c('POST', '/login', { email: emails[i], password: 'pass1234' })));
    await Promise.all(clients.map(c => c('POST', '/api/v1/registrations/enroll',
      { eventId, sessionId: session._id.toString(), eligibilityConfirmed: true, termsAccepted: true }, { json: true })));
    const s = await Session.findById(session._id);
    assert.ok(s.bookedSeats <= 3, `booked ${s.bookedSeats}`);
  });

  // UC-012
  const todayEvent = await Event.findOne({ title: 'Engineering Open House - Day 1' });
  const tSession = await Session.findOne({ event: todayEvent._id, sessionTitle: /Robotics/ });

  let roster;
  await check('UC-012 roster loads for owning coordinator', async () => {
    const r = await coord('GET', `/api/v1/sessions/${tSession._id}/roster`);
    assert.strictEqual(r.status, 200);
    roster = r.data.participants;
    assert.ok(roster.length >= 3);
  });

  await check('BR-008 other coordinator cannot record attendance', async () => {
    const mba = client();
    await mba('POST', '/login', { email: 'coord.mba@openease.test', password: 'pass1234' });
    const r = await mba('GET', `/api/v1/sessions/${tSession._id}/roster`);
    assert.strictEqual(r.status, 403);
  });

  await check('UC-012 batch record + reject foreign registration', async () => {
    const foreign = await Registration.findOne({ session: { $ne: tSession._id }, status: 'REGISTERED' });
    const r = await coord('POST', '/api/v1/attendance/batch-record', {
      sessionId: tSession._id.toString(),
      rosterRecords: [
        { registrationId: roster[0].registrationId, status: 'PRESENT' },
        { registrationId: roster[2].registrationId, status: 'ABSENT' },
        { registrationId: foreign._id.toString(), status: 'PRESENT' }
      ]
    }, { json: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.processedRecords, 2);
    assert.strictEqual(r.data.failedRecords, 1);
  });

  await check('UC-012 web form commit works', async () => {
    const body = {};
    roster.forEach(p => { body[`status[${p.registrationId}]`] = 'PRESENT'; });
    const r = await coord('POST', `/coordinator/sessions/${tSession._id}/attendance`, body);
    assert.strictEqual(r.status, 302);
    const again = await coord('GET', `/api/v1/sessions/${tSession._id}/roster`);
    assert.ok(again.data.participants.every(p => p.currentStatus === 'PRESENT'));
  });

  // UC-016
  await check('UC-016 CSV export of participants returns CSV data', async () => {
    const r = await coord('GET', `/coordinator/events/${todayEvent._id}/participants.csv`);
    assert.strictEqual(r.status, 200);
    assert.ok(String(r.data).includes('Reg ID'));
  });

  // UC-015
  await check('UC-015 coordinator sends event reminder', async () => {
    const r = await coord('POST', `/coordinator/events/${todayEvent._id}/remind`, {});
    assert.strictEqual(r.status, 302);
  });

  await check('UC-015 mark all notifications as read', async () => {
    const r = await student('POST', '/notifications/read-all', {});
    assert.strictEqual(r.status, 302);
  });

  // UC-001
  await check('UC-001 user self-registration creates account and logs in', async () => {
    const freshClient = client();
    const r = await freshClient('POST', '/register', {
      fullName: 'Vikram Sharma',
      email: 'vikram.new@student.test',
      password: 'password123',
      confirm: 'password123',
      participantType: 'STUDENT',
      contactPhone: '9123456789'
    });
    assert.strictEqual(r.status, 302);
    const user = await User.findOne({ email: 'vikram.new@student.test' });
    assert.ok(user);
    assert.strictEqual(user.role, 'STUDENT_PARENT');
    assert.strictEqual(user.accountStatus, 'ACTIVE');
  });

  // UC-014
  await check('UC-014 participant submits post-event feedback (BR-009)', async () => {
    // Find an attendee from todayEvent who was marked PRESENT
    const presentAtt = await Attendance.findOne({ event: todayEvent._id, status: 'PRESENT' });
    const attendedReg = await Registration.findById(presentAtt.registration).populate('participant');
    assert.ok(attendedReg);
    const attendeeClient = client();
    await attendeeClient('POST', '/login', { email: attendedReg.participant.email, password: 'pass1234' });
    const r = await attendeeClient('POST', `/my/registrations/${attendedReg._id}/feedback`, {
      rating: '5',
      comments: 'Super informative open house sessions!'
    });
    assert.strictEqual(r.status, 302);
    const Feedback = require('../models/Feedback');
    const fb = await Feedback.findOne({ registration: attendedReg._id });
    assert.ok(fb);
    assert.strictEqual(fb.rating, 5);

    // Duplicate feedback should be blocked (BR-006 / FR-035)
    const r2 = await attendeeClient('POST', `/my/registrations/${attendedReg._id}/feedback`, { rating: '4', comments: 'Again' });
    assert.strictEqual(r2.status, 302);
    assert.strictEqual(await Feedback.countDocuments({ registration: attendedReg._id }), 1);
  });

  // UC-002
  const admin = client();
  await check('UC-002 admin user management: create, toggle status, and RBAC', async () => {
    await admin('POST', '/login', { email: 'admin@openease.test', password: 'pass1234' });
    const rList = await admin('GET', '/admin/users');
    assert.strictEqual(rList.status, 200);

    // Create user
    const rCreate = await admin('POST', '/admin/users', {
      fullName: 'Prof. AdminCreated',
      email: 'prof.created@openease.test',
      password: 'password123',
      role: 'COORDINATOR',
      department: 'ECE Department',
      accountStatus: 'ACTIVE'
    });
    assert.strictEqual(rCreate.status, 302);
    const newUser = await User.findOne({ email: 'prof.created@openease.test' });
    assert.ok(newUser);
    assert.strictEqual(newUser.role, 'COORDINATOR');

    // Toggle status to DISABLED
    const rToggle = await admin('POST', `/admin/users/${newUser._id}/toggle-status`, {});
    assert.strictEqual(rToggle.status, 302);
    const disabledUser = await User.findById(newUser._id);
    assert.strictEqual(disabledUser.accountStatus, 'DISABLED');

    // Attempt login while DISABLED -> 403
    const userClient = client();
    const rBlocked = await userClient('POST', '/login', { email: 'prof.created@openease.test', password: 'password123' });
    assert.strictEqual(rBlocked.status, 403);

    // Toggle back to ACTIVE
    await admin('POST', `/admin/users/${newUser._id}/toggle-status`, {});
    const rOk = await userClient('POST', '/login', { email: 'prof.created@openease.test', password: 'password123' });
    assert.strictEqual(rOk.status, 302);
  });

  // UC-005
  await check('UC-005 coordinator cancels event with reason', async () => {
    const cancelEv = new Event({
      title: 'Temp Event For Cancellation',
      coordinator: (await User.findOne({ email: 'coord.cse@openease.test' }))._id,
      status: 'SUBMITTED',
      totalMaxCapacity: 20
    });
    await cancelEv.save();
    const r = await coord('POST', `/coordinator/events/${cancelEv._id}/cancel`, { reason: 'Severe weather advisory' });
    assert.strictEqual(r.status, 302);
    const updated = await Event.findById(cancelEv._id);
    assert.strictEqual(updated.status, 'CANCELLED');
    assert.strictEqual(updated.cancelReason, 'Severe weather advisory');
  });

  // Category 3 & 4 Architectural & Context Diagram Integrations
  await check('CALENDAR Campus Calendar Sync Engine generates RFC 5545 .ics', async () => {
    const rPublic = await anon('GET', `/events/${todayEvent._id}/calendar.ics`);
    assert.strictEqual(rPublic.status, 200);
    assert.ok(String(rPublic.data).includes('BEGIN:VCALENDAR'));
    assert.ok(String(rPublic.data).includes('BEGIN:VEVENT'));

    const reg = await Registration.findOne({ status: 'REGISTERED' });
    const rPersonal = await student('GET', `/my/registrations/${reg._id}/calendar.ics`);
    assert.strictEqual(rPersonal.status, 200);
    assert.ok(String(rPersonal.data).includes('BEGIN:VCALENDAR'));
  });

  await check('QR-CODE Booking receipt displays scannable 2D QR barcode', async () => {
    const reg = await Registration.findOne({ participant: (await User.findOne({ email: 'aarav@student.test' }))._id });
    assert.ok(reg);
    const r = await student('GET', `/my/registrations/${reg._id}`);
    assert.strictEqual(r.status, 200);
    assert.ok(String(r.data).includes('data:image/png;base64,'));
  });

  await check('LDAP Institutional directory authenticates faculty credentials', async () => {
    const ldapClient = client();
    const r = await ldapClient('POST', '/login', {
      email: 'faculty.cse@lnmiit.ac.in',
      password: 'pass1234'
    });
    assert.strictEqual(r.status, 302);
    const u = await User.findOne({ email: 'faculty.cse@lnmiit.ac.in' });
    assert.ok(u);
    assert.strictEqual(u.role, 'COORDINATOR');
    assert.strictEqual(u.department, 'Computer Science and Engineering');
  });

  await check('SYSLOG Central syslog daemon streams RFC 5424 audit messages', async () => {
    const dispatcher = require('../utility/auditAlertDispatcher');
    const lines = dispatcher.getRecentSyslog(20);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].startsWith('<134>1'));
    const rSys = await admin('GET', '/admin/syslog');
    assert.strictEqual(rSys.status, 200);
    assert.ok(String(rSys.data).includes('Central Syslog Daemon'));
  });

  await check('MEDIA Campus venue maps and event brochures are accessible', async () => {
    const rMap = await anon('GET', '/media/maps/campus-venue-map.svg');
    assert.strictEqual(rMap.status, 200);
    const rBrochure = await anon('GET', '/media/brochures/open-house-brochure.svg');
    assert.strictEqual(rBrochure.status, 200);
  });

  // pages render
  await check('all main pages render (200)', async () => {
    const pages = [
      [anon, '/'], [anon, '/events'], [anon, `/events/${todayEvent._id}`], [anon, '/login'], [anon, '/register'],
      [student, '/my/registrations'], [student, '/notifications'],
      [student, `/events/${eventId}/register`.replace(eventId, (await Event.findOne({ title: 'Campus Tour & Hostel Visit' }))._id)],
      [coord, '/coordinator'], [coord, '/coordinator/events'], [coord, '/coordinator/attendance'], [coord, '/coordinator/events/new'], [coord, `/coordinator/events/${eventId}`],
      [coord, `/coordinator/sessions/${tSession._id}/attendance`], [coord, '/reports'], [coord, `/reports/events/${todayEvent._id}`],
      [approver, '/approver'], [admin, '/admin/users'], [admin, '/admin/users/new']
    ];
    for (const [c, p] of pages) {
      const r = await c('GET', p);
      assert.strictEqual(r.status, 200, `${p} returned ${r.status}`);
    }
  });

  server.close();

  console.log('');
  results.forEach(([s, n]) => console.log(`${s === 'PASS' ? '  ok ' : ' FAIL'}  ${n}`));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
