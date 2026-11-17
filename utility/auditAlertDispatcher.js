// tier 3: Audit & Alert Dispatcher (Figure 50.1 Peer Syslog Daemon & Notification stream)
// writes the audit log, streams to RFC 5424 syslog daemon, and sends in-app notifications.
const fs = require('fs');
const path = require('path');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Registration = require('../models/Registration');
const User = require('../models/User');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const SYSLOG_PATH = path.join(LOGS_DIR, 'syslog.log');

// RFC 5424 Syslog message format: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD-ELEMENT] MSG
function formatSyslogRfc5424(actorId, action, target, details) {
  const timestamp = new Date().toISOString();
  const hostname = 'openease.campus.internal';
  const appName = 'OpenEaseEngine';
  const procId = process.pid;
  const msgId = action || 'AUDIT';
  const structuredData = `[audit@openease actor="${actorId || 'system'}" target="${target || '-'}" action="${action}"]`;
  const msg = (details || '').replace(/[\r\n]+/g, ' ');
  // Facility: local0 (16), Severity: Informational (6) -> (16*8)+6 = 134
  return `<134>1 ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${msg}\n`;
}

function writeSyslogStream(line) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFile(SYSLOG_PATH, line, 'utf8', () => {});
  } catch (err) {
    // Non-blocking fallback
  }
}

async function log(actorId, action, target, details) {
  try {
    await AuditLog.create({ actor: actorId, action, target, details });
  } catch (err) {
    console.error('[audit] failed to write database log', err.message);
  }

  // Central Syslog Daemon Stream (Figure 50.1)
  const syslogLine = formatSyslogRfc5424(actorId, action, target, details);
  writeSyslogStream(syslogLine);
}

function getRecentSyslog(maxLines = 50) {
  try {
    if (!fs.existsSync(SYSLOG_PATH)) return [];
    const content = fs.readFileSync(SYSLOG_PATH, 'utf8');
    return content.trim().split('\n').filter(Boolean).slice(-maxLines).reverse();
  } catch (err) {
    return [];
  }
}

async function notifyUser(userId, type, message, link) {
  return Notification.create({ recipient: userId, type, message, link });
}

async function notifyRole(role, type, message, link) {
  const users = await User.find({ role, accountStatus: 'ACTIVE' }).select('_id');
  if (!users.length) return 0;
  await Notification.insertMany(users.map(u => ({ recipient: u._id, type, message, link })));
  return users.length;
}

// everyone holding a registration for the event (FR-038, FR-039, FR-040)
async function notifyRegistrants(eventId, type, message, link) {
  const regs = await Registration.find({ event: eventId, status: 'REGISTERED' }).select('participant');
  if (!regs.length) return 0;
  await Notification.insertMany(regs.map(r => ({ recipient: r.participant, type, message, link })));
  return regs.length;
}

module.exports = { log, notifyUser, notifyRole, notifyRegistrants, getRecentSyslog, SYSLOG_PATH };
