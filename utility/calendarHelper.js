// Campus Calendar Sync Engine (Figure 50.1 - RFC 5545 iCalendar generator)
function formatIcsDateTime(date, timeStr = '09:00') {
  if (!date) return '';
  const d = new Date(date);
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  d.setHours(h || 9, m || 0, 0, 0);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function generateEventIcs(event, session = null) {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const eventDate = event.schedule ? event.schedule.eventDate : new Date();
  const startTime = session ? session.startTime : (event.schedule ? event.schedule.startTime : '09:00');
  const endTime = session ? session.endTime : (event.schedule ? event.schedule.endTime : '17:00');
  const dtStart = formatIcsDateTime(eventDate, startTime);
  const dtEnd = formatIcsDateTime(eventDate, endTime);

  const title = session
    ? `${session.sessionTitle} - ${event.title}`
    : event.title;

  const venueLabel = session && session.venue
    ? (session.venue.label || `${session.venue.roomNumber}, ${session.venue.buildingName}`)
    : (event.venue ? (event.venue.label || `${event.venue.roomNumber}, ${event.venue.buildingName}`) : 'Campus Main Campus');

  const description = [
    session ? `Breakout Session: ${session.sessionTitle}` : '',
    session && session.sessionDescription ? session.sessionDescription : '',
    event.description || '',
    event.organizer ? `Organized by: ${event.organizer}` : '',
    'OpenEase Campus Open House Management Engine'
  ].filter(Boolean).join('\n\n');

  const uid = `${event.eventId || 'EVT'}-${session ? (session.sessionId || 'SES') : 'MAIN'}-${Date.now()}@openease.lnmiit.ac.in`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenEase Campus Event Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(venueLabel)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

module.exports = { generateEventIcs };
