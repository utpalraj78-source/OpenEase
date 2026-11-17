// demo data -> npm run seed
// WARNING this deletes everything in the openease db first!!
// dates are based on today so there's always an event happening today (for attendance)
// and one with registration open (for registering)
require('dotenv').config();
const { getPostgresClient } = require('../config/postgres');
const { init } = require('./init-pg-db');

const User = require('../models/User');
const EventCategory = require('../models/EventCategory');
const RegistrationValidation = require('../models/RegistrationValidation');
const Venue = require('../models/Venue');
const Event = require('../models/Event');
const Session = require('../models/Session');
const Registration = require('../models/Registration');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { Counter, nextCode } = require('../models/Counter');

const PASSWORD = 'pass1234';

function day(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
function at(offset, hh, mm = 0) {
  const d = day(offset);
  d.setHours(hh, mm, 0, 0);
  return d;
}

async function seed(uri) {
  await init();
  await Promise.all([User, EventCategory, Venue, Event, Session, Registration, RegistrationValidation, Attendance, Feedback, Notification, AuditLog, Counter]
    .map(m => m.deleteMany({})));

  const hash = await User.hashPassword(PASSWORD);
  const mk = (o) => ({ passwordHash: hash, ...o });

  // staff - each role is its own subclass of User
  const staff = async (Model, prefix, idField, o) =>
    Model.create(mk({ userId: await nextCode('USR'), ...(idField ? { [idField]: await nextCode(prefix) } : {}), ...o }));
  const admin = await staff(User.Administrator, null, null, { fullName: 'System Admin', email: 'admin@openease.test', department: 'IT Cell' });
  const coordCse = await staff(User.EventCoordinator, 'COO', 'coordinatorId', { fullName: 'Prof. Nikhil Joshi', email: 'coord.cse@openease.test', department: 'Dept. of Computer Engineering', officeRoom: 'E-214' });
  const coordMgmt = await staff(User.EventCoordinator, 'COO', 'coordinatorId', { fullName: 'Dr. Kavita Rao', email: 'coord.mba@openease.test', department: 'School of Management', officeRoom: 'M-105' });
  const approver = await staff(User.EventApprover, 'APR', 'approverId', { fullName: 'Dr. S. Mehta', email: 'approver@openease.test', administrativeRank: 'Dean Academics', departmentScope: 'All departments' });
  await staff(User.InstituteManagement, null, null, { fullName: 'Dean Admissions', email: 'dean@openease.test', department: 'Admissions' });

  const sp = async o => User.StudentParent.create(mk({ userId: await nextCode('USR'), participantId: await nextCode('PAR'), ...o }));
  const students = [];
  for (const o of [
    { fullName: 'Aarav Patel', email: 'aarav@student.test', contactPhone: '9876500011', participantType: 'STUDENT', eligibilityStatus: 'CLASS_12_SCIENCE', currentInstitution: 'Udgam School, Ahmedabad' },
    { fullName: 'Meera Shah', email: 'meera@parent.test', contactPhone: '9876500012', participantType: 'PARENT', eligibilityStatus: 'OTHER', currentInstitution: '' },
    { fullName: 'Riya Desai', email: 'riya@student.test', contactPhone: '9876500013', participantType: 'STUDENT', eligibilityStatus: 'CLASS_12_SCIENCE', currentInstitution: 'DPS Bopal' },
    { fullName: 'Kabir Trivedi', email: 'kabir@student.test', contactPhone: '9876500014', participantType: 'STUDENT', eligibilityStatus: 'CLASS_12_COMMERCE', currentInstitution: 'St. Xavier\'s Loyola' },
    { fullName: 'Ananya Iyer', email: 'ananya@student.test', contactPhone: '9876500015', participantType: 'STUDENT', eligibilityStatus: 'CLASS_12_SCIENCE', currentInstitution: 'Kendriya Vidyalaya SAC' },
    { fullName: 'Dev Chauhan', email: 'dev@student.test', contactPhone: '9876500016', participantType: 'STUDENT', eligibilityStatus: 'CLASS_11', currentInstitution: 'Nirma Vidyavihar' },
    { fullName: 'Ishaan Bhatt', email: 'ishaan@student.test', contactPhone: '9876500017', participantType: 'STUDENT', eligibilityStatus: 'CLASS_12_SCIENCE', currentInstitution: 'Anand Niketan' },
    { fullName: 'Pooja Nair', email: 'pooja@parent.test', contactPhone: '9876500018', participantType: 'PARENT', eligibilityStatus: 'OTHER' }
  ]) students.push(await sp(o));

  const [ugCat, campusCat, pgCat] = await EventCategory.create([
    { categoryId: 'CAT-01', categoryName: 'Undergraduate Admissions', description: 'B.Tech / B.Sc / BBA open days' },
    { categoryId: 'CAT-02', categoryName: 'Campus Showcase', description: 'Labs, hostels and student clubs' },
    { categoryId: 'CAT-03', categoryName: 'Postgraduate Programmes', description: 'M.Tech, MBA, M.Sc' }
  ]);

  const [audi, seminar, lab1, lab2, hostel, mbaHall] = await Venue.create([
    { venueId: 'VEN-01', buildingName: 'Admin Block', roomNumber: 'Main Auditorium', seatingCapacity: 400, hasProjector: true },
    { venueId: 'VEN-02', buildingName: 'Block C', roomNumber: 'Seminar Hall A', seatingCapacity: 120, hasProjector: true },
    { venueId: 'VEN-03', buildingName: 'Block E', roomNumber: 'Robotics Lab', seatingCapacity: 40 },
    { venueId: 'VEN-04', buildingName: 'Block E', roomNumber: 'Computing Lab 3', seatingCapacity: 60, hasProjector: true },
    { venueId: 'VEN-05', buildingName: 'Hostel Gate', roomNumber: 'Hostel Reception', seatingCapacity: 50 },
    { venueId: 'VEN-06', buildingName: 'Management Block', roomNumber: 'MBA Case Room', seatingCapacity: 80, hasProjector: true }
  ]);
  await Venue.create({ venueId: 'VEN-07', buildingName: 'Block A', roomNumber: 'Old Library Hall', seatingCapacity: 100, isOperational: false });

  // the event data below is written flat because it's easier to read,
  // this builds the Schedule / RegistrationPeriod / EligibilityCriteria parts
  async function makeEvent(d, sessions) {
    const { date, startTime, endTime, capacity, registrationStart, registrationEnd, eligibility, instructions, ...rest } = d;
    const ev = await Event.create({
      eventId: await nextCode('EVT'), ...rest,
      schedule: { scheduleId: await nextCode('SCH'), eventDate: date, startTime, endTime },
      registrationPeriod: { registrationStart, registrationEnd },
      eligibilityCriteria: { criteriaId: eligibility || 'GENERAL_PUBLIC', description: instructions },
      totalMaxCapacity: capacity
    });
    const created = [];
    for (const { title, ...x } of sessions) {
      created.push(await Session.create({ sessionId: await nextCode('SES'), event: ev._id, sessionTitle: title, ...x }));
    }
    return { ev, sessions: created };
  }

  // 1) happening today - registration already closed, used for attendance demo
  const today = await makeEvent({
    title: 'Engineering Open House - Day 1',
    description: 'Walk through our engineering departments, meet faculty and current students, and get your admission questions answered.\n\nThe day starts with a welcome address in the Main Auditorium followed by department-wise sessions.',
    category: ugCat._id, date: day(0), startTime: '09:00', endTime: '15:00', venue: audi._id,
    organizer: 'Dept. of Computer Engineering', coordinator: coordCse._id, capacity: 150,
    registrationStart: at(-20, 9), registrationEnd: at(-1, 18), eligibility: 'CLASS_12_STEM',
    instructions: 'Carry a photo ID. Report at the Admin Block help desk 15 minutes early.',
    status: 'PUBLISHED', publishedAt: at(-21, 11),
    reviews: [{ reviewer: approver._id, decision: 'APPROVED', comments: 'Looks good.', decidedAt: at(-21, 10) }]
  }, [
    { title: 'Robotics & AI lab tour', speaker: 'Prof. Nikhil Joshi', startTime: '10:00', endTime: '11:00', venue: lab1._id, allocatedCapacity: 40 },
    { title: 'Coding bootcamp demo', speaker: 'ACM student chapter', startTime: '11:15', endTime: '12:15', venue: lab2._id, allocatedCapacity: 60 },
    { title: 'Admissions & scholarships Q&A', speaker: 'Admissions office', startTime: '13:00', endTime: '14:00', venue: seminar._id, allocatedCapacity: 50 }
  ]);

  // 2) published, registration open
  const open = await makeEvent({
    title: 'Campus Tour & Hostel Visit',
    description: 'A relaxed guided tour for students and parents: library, sports complex, mess and both hostels. Parents can meet the wardens.',
    category: campusCat._id, date: day(18), startTime: '10:00', endTime: '13:30', venue: audi._id,
    organizer: 'Student Affairs', coordinator: coordCse._id, capacity: 120,
    registrationStart: at(-3, 9), registrationEnd: at(16, 23, 59), eligibility: 'GENERAL_PUBLIC',
    instructions: 'Wear comfortable shoes, the tour covers about 2 km. Parking near Gate 2.',
    status: 'PUBLISHED', publishedAt: at(-3, 9),
    reviews: [{ reviewer: approver._id, decision: 'APPROVED', comments: '', decidedAt: at(-4, 15) }]
  }, [
    { title: 'Morning tour (Group A)', speaker: 'Student volunteers', startTime: '10:00', endTime: '11:30', venue: hostel._id, allocatedCapacity: 50 },
    { title: 'Late morning tour (Group B)', speaker: 'Student volunteers', startTime: '11:45', endTime: '13:15', venue: hostel._id, allocatedCapacity: 50 },
    { title: 'Parents meet the wardens', speaker: 'Chief Warden', startTime: '10:30', endTime: '11:30', venue: seminar._id, allocatedCapacity: 20 }
  ]);

  // 3) submitted - waiting for the approver
  await makeEvent({
    title: 'MBA Open Day 2027',
    description: 'Overview of the MBA programme, specialisations and placement record. Includes a sample case discussion.',
    category: pgCat._id, date: day(30), startTime: '11:00', endTime: '16:00', venue: mbaHall._id,
    organizer: 'School of Management', coordinator: coordMgmt._id, capacity: 80,
    registrationStart: at(2, 9), registrationEnd: at(28, 18), eligibility: 'TRANSFER',
    status: 'SUBMITTED'
  }, [
    { title: 'Programme overview', speaker: 'Dr. Kavita Rao', startTime: '11:00', endTime: '12:00', venue: mbaHall._id, allocatedCapacity: 50 },
    { title: 'Sample case discussion', speaker: 'Faculty panel', startTime: '14:00', endTime: '15:30', venue: mbaHall._id, allocatedCapacity: 30 }
  ]);

  // 4) approved, ready to publish
  await makeEvent({
    title: 'Engineering Open House - Day 2',
    description: 'Second day of the engineering open house focused on Civil, Mechanical and Electrical departments.',
    category: ugCat._id, date: day(25), startTime: '09:30', endTime: '14:00', venue: audi._id,
    organizer: 'Dept. of Computer Engineering', coordinator: coordCse._id, capacity: 100,
    registrationStart: at(1, 9), registrationEnd: at(23, 18), eligibility: 'CLASS_12_STEM',
    status: 'APPROVED',
    reviews: [{ reviewer: approver._id, decision: 'APPROVED', comments: 'Approved. Please publish after confirming lab availability.', decidedAt: at(0, 9) }]
  }, [
    { title: 'Mechanical workshop walkthrough', startTime: '10:00', endTime: '11:00', venue: lab1._id, allocatedCapacity: 40 },
    { title: 'Electrical & EV lab', startTime: '11:30', endTime: '12:30', venue: lab2._id, allocatedCapacity: 60 }
  ]);

  // 5) draft
  await makeEvent({
    title: 'Science Faculty Open Evening',
    description: 'Draft - details still being worked out.',
    category: ugCat._id, coordinator: coordCse._id, organizer: 'Faculty of Science', status: 'DRAFT'
  }, []);

  // registrations for event 1 (today) and event 2 (open)
  const regs = [];
  async function reg(student, ev, session, guests = 0) {
    const r = await Registration.create({
      registrationId: await nextCode('REG'), participant: student._id, event: ev._id, session: session._id,
      status: 'REGISTERED', fullName: student.fullName, email: student.email, contactPhone: student.contactPhone,
      participantType: student.participantType, currentInstitution: student.currentInstitution, guests,
      eligibilityConfirmed: true, termsAccepted: true
    });
    await Session.updateOne({ _id: session._id }, { $inc: { bookedSeats: 1 } });
    regs.push(r);
    return r;
  }
  const [s1, s2, s3] = today.sessions;
  await reg(students[0], today.ev, s1, 1);
  await reg(students[2], today.ev, s1);
  await reg(students[4], today.ev, s1);
  await reg(students[6], today.ev, s2);
  await reg(students[1], today.ev, s3);
  await reg(students[7], today.ev, s3);

  const [o1, , o3] = open.sessions;
  await reg(students[2], open.ev, o1);
  await reg(students[4], open.ev, o1, 2);
  await reg(students[7], open.ev, o3);
  await reg(students[3], open.ev, o1);

  // a couple of attendance marks already in for the first session
  const s1regs = regs.filter(r => String(r.session) === String(s1._id));
  await Attendance.create([
    { attendanceId: await nextCode('ATT'), registration: s1regs[0]._id, event: today.ev._id, session: s1._id, participant: s1regs[0].participant, status: 'PRESENT', recordedByUserId: coordCse._id },
    { attendanceId: await nextCode('ATT'), registration: s1regs[1]._id, event: today.ev._id, session: s1._id, participant: s1regs[1].participant, status: 'PRESENT', recordedByUserId: coordCse._id }
  ]);

  await Notification.create([
    { recipient: students[0]._id, type: 'REGISTRATION', message: `You are registered for "${today.ev.title}". Session: ${s1.sessionTitle}.`, link: '/my/registrations' },
    { recipient: students[0]._id, type: 'REMINDER', message: `Reminder: "${today.ev.title}" is today at 09:00. Carry a photo ID.`, link: '/my/registrations' },
    { recipient: approver._id, type: 'REVIEW', message: '"MBA Open Day 2027" was submitted for approval.', link: '/approver' }
  ]);

  console.log('\nSeed complete. Log in with any of these (password: %s)', PASSWORD);
  console.table([
    { role: 'Student', email: 'aarav@student.test' },
    { role: 'Parent', email: 'meera@parent.test' },
    { role: 'Coordinator', email: 'coord.cse@openease.test' },
    { role: 'Coordinator (MBA)', email: 'coord.mba@openease.test' },
    { role: 'Approver', email: 'approver@openease.test' },
    { role: 'Management', email: 'dean@openease.test' },
    { role: 'Admin', email: 'admin@openease.test' }
  ]);
  return { admin };
}

if (require.main === module) {
  seed()
    .then(() => {
      console.log('PostgreSQL database seeded successfully.');
      process.exit(0);
    })
    .catch(err => { console.error('Seed failed:', err); process.exit(1); });
}

module.exports = seed;
