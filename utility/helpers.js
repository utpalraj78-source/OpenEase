// date/time helpers used everywhere

function parseDateOnly(str) {
  // "2026-11-15" -> local midnight. new Date(str) gives UTC and the date was showing one day off
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function parseDateTimeLocal(str) {
  // value from <input type="datetime-local">: "2026-11-01T09:00"
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDate(d) {
  if (!d) return '-';
  d = new Date(d);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTime(hhmm) {
  if (!hhmm) return '-';
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function fmtDateTime(d) {
  if (!d) return '-';
  d = new Date(d);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${fmtTime(t)}`;
}

function toInputDate(d) {
  if (!d) return '';
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toInputDateTime(d) {
  if (!d) return '';
  d = new Date(d);
  return `${toInputDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function statusLabel(s) {
  return (s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

// "Prof. Nikhil Joshi" -> "Nikhil"
function firstName(name) {
  return (name || '').replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '').split(' ')[0];
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  parseDateOnly, parseDateTimeLocal, toMinutes, overlaps,
  fmtDate, fmtTime, fmtDateTime, toInputDate, toInputDateTime, timeAgo, statusLabel, escapeRegex, firstName
};
