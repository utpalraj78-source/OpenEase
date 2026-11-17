// OpenEase - Complete MongoDB to PostgreSQL Migration Script
require('dotenv').config();
const mongoose = require('mongoose');
const { getPostgresClient } = require('../config/postgres');
const { init } = require('./init-pg-db');
const connectDB = require('../config/db');

// Models
const User = require('../models/User');
const Venue = require('../models/Venue');
const EventCategory = require('../models/EventCategory');
const Event = require('../models/Event');
const Session = require('../models/Session');
const Registration = require('../models/Registration');
const Attendance = require('../models/Attendance');
const Feedback = require('../models/Feedback');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const { Counter } = require('../models/Counter');

async function migrate() {
  console.log('--- Step 1: Connecting to PostgreSQL ---');
  await init();
  const pg = await getPostgresClient();

  console.log('--- Step 2: Connecting to MongoDB ---');
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/openease';
  await connectDB(mongoUri);

  console.log('--- Step 3: Migrating Collections ---');

  // 1. Users
  const users = await User.find({}).lean();
  for (const u of users) {
    const id = String(u._id);
    const doc = JSON.stringify(u);
    await pg.query(
      `INSERT INTO users (id, user_id, email, role, account_status, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET doc = $6, updated_at = $8;`,
      [id, u.userId || null, u.email, u.role, u.accountStatus || 'ACTIVE', doc, u.createdAt || new Date(), u.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${users.length} Users.`);

  // 2. Categories
  const categories = await EventCategory.find({}).lean();
  for (const c of categories) {
    const id = String(c._id);
    const doc = JSON.stringify(c);
    await pg.query(
      `INSERT INTO event_categories (id, category_id, category_name, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET doc = $4, updated_at = $6;`,
      [id, c.categoryId || null, c.categoryName, doc, c.createdAt || new Date(), c.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${categories.length} Event Categories.`);

  // 3. Venues
  const venues = await Venue.find({}).lean();
  for (const v of venues) {
    const id = String(v._id);
    const doc = JSON.stringify(v);
    await pg.query(
      `INSERT INTO venues (id, venue_id, building_name, room_number, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET doc = $5, updated_at = $7;`,
      [id, v.venueId || null, v.buildingName, v.roomNumber, doc, v.createdAt || new Date(), v.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${venues.length} Venues.`);

  // 4. Events
  const events = await Event.find({}).lean();
  for (const e of events) {
    const id = String(e._id);
    const doc = JSON.stringify(e);
    await pg.query(
      `INSERT INTO events (id, event_id, title, status, coordinator_id, venue_id, category_id, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET doc = $8, updated_at = $10;`,
      [id, e.eventId || null, e.title, e.status, String(e.coordinator || ''), String(e.venue || ''), String(e.category || ''), doc, e.createdAt || new Date(), e.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${events.length} Events.`);

  // 5. Sessions
  const sessions = await Session.find({}).lean();
  for (const s of sessions) {
    const id = String(s._id);
    const doc = JSON.stringify(s);
    await pg.query(
      `INSERT INTO sessions (id, session_id, event_id, session_title, allocated_capacity, booked_seats, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET doc = $7, updated_at = $9;`,
      [id, s.sessionId || null, String(s.event || ''), s.sessionTitle, s.allocatedCapacity || 0, s.bookedSeats || 0, doc, s.createdAt || new Date(), s.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${sessions.length} Sessions.`);

  // 6. Registrations
  const registrations = await Registration.find({}).lean();
  for (const r of registrations) {
    const id = String(r._id);
    const doc = JSON.stringify(r);
    await pg.query(
      `INSERT INTO registrations (id, registration_id, event_id, session_id, participant_id, email, status, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET doc = $8, updated_at = $10;`,
      [id, r.registrationId || null, String(r.event || ''), String(r.session || ''), String(r.participant || ''), r.email, r.status, doc, r.createdAt || new Date(), r.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${registrations.length} Registrations.`);

  // 7. Attendance
  const attendances = await Attendance.find({}).lean();
  for (const a of attendances) {
    const id = String(a._id);
    const doc = JSON.stringify(a);
    await pg.query(
      `INSERT INTO attendance (id, attendance_id, event_id, session_id, participant_id, registration_id, status, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET doc = $8, updated_at = $10;`,
      [id, a.attendanceId || null, String(a.event || ''), String(a.session || ''), String(a.participant || ''), String(a.registration || ''), a.status, doc, a.createdAt || new Date(), a.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${attendances.length} Attendance records.`);

  // 8. Feedback
  const feedbacks = await Feedback.find({}).lean();
  for (const f of feedbacks) {
    const id = String(f._id);
    const doc = JSON.stringify(f);
    await pg.query(
      `INSERT INTO feedback (id, feedback_id, event_id, participant_id, registration_id, rating, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET doc = $7, updated_at = $9;`,
      [id, f.feedbackId || null, String(f.event || ''), String(f.participant || ''), String(f.registration || ''), f.rating, doc, f.createdAt || new Date(), f.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${feedbacks.length} Feedback submissions.`);

  // 9. Audit Logs
  const logs = await AuditLog.find({}).lean();
  for (const l of logs) {
    const id = String(l._id);
    const doc = JSON.stringify(l);
    await pg.query(
      `INSERT INTO audit_logs (id, actor_id, action, doc, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET doc = $4;`,
      [id, String(l.actor || ''), l.action, doc, l.createdAt || new Date()]
    );
  }
  console.log(`Migrated ${logs.length} Audit Logs.`);

  // 10. Counters
  const counters = await Counter.find({}).lean();
  for (const cnt of counters) {
    const id = String(cnt._id);
    const doc = JSON.stringify(cnt);
    await pg.query(
      `INSERT INTO counters (id, seq, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET seq = $2, doc = $3, updated_at = $5;`,
      [id, cnt.seq || 0, doc, cnt.createdAt || new Date(), cnt.updatedAt || new Date()]
    );
  }
  console.log(`Migrated ${counters.length} Counters.`);

  console.log('--- Step 4: Verification in PostgreSQL ---');
  const counts = await Promise.all([
    pg.query('SELECT count(*) FROM users'),
    pg.query('SELECT count(*) FROM events'),
    pg.query('SELECT count(*) FROM registrations'),
    pg.query('SELECT count(*) FROM attendance')
  ]);
  console.log(`PostgreSQL Row Counts: Users=${counts[0].rows[0].count}, Events=${counts[1].rows[0].count}, Registrations=${counts[2].rows[0].count}, Attendance=${counts[3].rows[0].count}`);
  console.log('ALL DATA MIGRATION FROM MONGODB TO POSTGRESQL COMPLETE!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
