// tier 2: EventWorkflowService (UC-003 life cycle & review) - FR-006 to FR-015
// draft, validate, venue clash check, submit. approve/publish/cancel are also here
// but those routes are showcase only for now
const repo = require('../repositories/eventSessionRepository');
const registrations = require('../repositories/registrationRepository');
const guard = require('../utility/venueScheduleGuard');
const dispatcher = require('../utility/auditAlertDispatcher');
const ServiceError = require('../utility/errors');
const { nextCode } = require('../models/Counter');
const { EVENT_STATUS, EDITABLE_STATUSES, ELIGIBILITY } = require('../config/constants');
const { parseDateOnly, parseDateTimeLocal, toMinutes, fmtDate } = require('../utility/helpers');


// form body -> plain object (keys use the class diagram names)
function normaliseEventInput(body) {
  return {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    category: body.category || null,
    eventDate: parseDateOnly(body.eventDate),
    startTime: body.startTime || '',
    endTime: body.endTime || '',
    venue: body.venue || null,
    organizer: (body.organizer || '').trim(),
    totalMaxCapacity: body.totalMaxCapacity ? parseInt(body.totalMaxCapacity, 10) : null,
    registrationStart: parseDateTimeLocal(body.registrationStart),
    registrationEnd: parseDateTimeLocal(body.registrationEnd),
    criteriaId: body.criteriaId || 'GENERAL_PUBLIC',
    criteriaDescription: (body.criteriaDescription || '').trim()
  };
}

// sessions come from the dynamic table as parallel arrays: sessions[sessionTitle][] etc.
function normaliseSessionsInput(body) {
  const s = body.sessions || {};
  const arr = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const out = [];
  arr(s.sessionTitle).forEach((title, i) => {
    const row = {
      _id: arr(s.id)[i] || null,
      sessionTitle: (title || '').trim(),
      speaker: (arr(s.speaker)[i] || '').trim(),
      startTime: arr(s.startTime)[i] || '',
      endTime: arr(s.endTime)[i] || '',
      venue: arr(s.venue)[i] || null,
      allocatedCapacity: parseInt(arr(s.allocatedCapacity)[i], 10) || 0
    };
    // skip completely empty rows the user left in the table
    if (row.sessionTitle || row.startTime || row.venue) out.push(row);
  });
  return out;
}

// copies the flat input onto the event and its composed parts
function applyInput(event, input) {
  event.title = input.title;
  event.description = input.description;
  event.category = input.category;
  event.venue = input.venue;
  event.organizer = input.organizer;
  event.totalMaxCapacity = input.totalMaxCapacity;
  event.schedule = {
    scheduleId: (event.schedule && event.schedule.scheduleId) || null,
    eventDate: input.eventDate, startTime: input.startTime, endTime: input.endTime
  };
  event.registrationPeriod = { registrationStart: input.registrationStart, registrationEnd: input.registrationEnd };
  event.eligibilityCriteria = { criteriaId: input.criteriaId, description: input.criteriaDescription };
}

// the other way round, used when re-validating a saved draft
function inputFromEvent(event) {
  const s = event.schedule || {}, p = event.registrationPeriod || {}, c = event.eligibilityCriteria || {};
  return {
    title: event.title, description: event.description, category: event.category, venue: event.venue,
    organizer: event.organizer, totalMaxCapacity: event.totalMaxCapacity,
    eventDate: s.eventDate, startTime: s.startTime, endTime: s.endTime,
    registrationStart: p.registrationStart, registrationEnd: p.registrationEnd,
    criteriaId: c.criteriaId || 'GENERAL_PUBLIC', criteriaDescription: c.description
  };
}


// validation

// draft only needs a title. full checks run on submit (FR-008 vs FR-013)
function validateDraft(input) {
  const errors = [];
  if (!input.title || input.title.length < 5) errors.push('Title must be at least 5 characters, even for a draft.');
  if (input.title.length > 150) errors.push('Title cannot be longer than 150 characters.');
  return errors;
}

async function validateForSubmission(input, sessions, eventId) {
  const errors = [];
  const required = ['title', 'description', 'category', 'eventDate', 'startTime', 'endTime', 'venue',
    'totalMaxCapacity', 'registrationStart', 'registrationEnd'];
  if (required.some(k => !input[k])) errors.push('All mandatory fields must be completed before submission.');

  if (input.title && (input.title.length < 5 || input.title.length > 150)) {
    errors.push('Title must be between 5 and 150 characters.');
  }
  if (!ELIGIBILITY[input.criteriaId]) errors.push('Pick a valid eligibility option.');
  if (input.totalMaxCapacity !== null && (!Number.isInteger(input.totalMaxCapacity) || input.totalMaxCapacity < 1)) {
    errors.push('Total capacity must be a whole number greater than zero.');
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (input.eventDate && input.eventDate <= today) errors.push('Event date must be in the future.');

  const st = toMinutes(input.startTime), et = toMinutes(input.endTime);
  if (input.startTime && input.endTime) {
    if (st >= et) errors.push('Start time must precede end time.');
    if (!guard.withinCampusHours(input.startTime, input.endTime)) errors.push('Event timings must fall between 08:00 and 20:00.');
  }

  if (input.registrationStart && input.registrationEnd) {
    if (input.registrationStart >= input.registrationEnd) errors.push('Registration must open before it closes.');
    if (input.eventDate && input.registrationEnd >= input.eventDate) errors.push('Registration must close before the event day.');
  }

  let mainVenue = null;
  if (input.venue) {
    mainVenue = await repo.findVenueById(input.venue);
    if (!mainVenue) errors.push('Selected venue does not exist.');
    else if (!mainVenue.isOperational) errors.push(`${mainVenue.label} is under maintenance.`);
  }
  if (mainVenue && input.eventDate && input.startTime && input.endTime && st < et) {
    const clash = await guard.findClash(input.venue, input.eventDate, input.startTime, input.endTime, { eventId });
    if (clash) errors.push(`Selected venue ${mainVenue.label} is already booked for this time slot (${clash}).`);
  }

  // sessions
  if (!sessions.length) errors.push('Add at least one breakout session.');
  let total = 0;
  const venueIds = [...new Set(sessions.map(s => s.venue).filter(Boolean))];
  const venues = await repo.findVenuesByIds(venueIds);
  const venueMap = Object.fromEntries(venues.map(v => [String(v._id), v]));

  sessions.forEach((s, i) => {
    const label = s.sessionTitle || `Session ${i + 1}`;
    if (!s.sessionTitle || !s.startTime || !s.endTime || !s.venue || !s.allocatedCapacity) {
      errors.push(`${label}: title, time, venue and capacity are required.`);
      return;
    }
    if (toMinutes(s.startTime) >= toMinutes(s.endTime)) errors.push(`${label}: start time must precede end time.`);
    if (input.startTime && input.endTime && (toMinutes(s.startTime) < st || toMinutes(s.endTime) > et)) {
      errors.push(`${label}: session timings must fall inside the event window.`);
    }
    const v = venueMap[String(s.venue)];
    if (v && !v.verifyCapacity(s.allocatedCapacity)) {
      errors.push(v.isOperational ? `${label}: ${v.label} only seats ${v.seatingCapacity}.` : `${label}: ${v.label} is under maintenance.`);
    }
    total += s.allocatedCapacity;
  });

  errors.push(...guard.internalClashes(sessions));

  if (input.totalMaxCapacity && total > input.totalMaxCapacity) {
    errors.push(`Sum of session capacities (${total}) cannot exceed total event capacity (${input.totalMaxCapacity}).`);
  }

  // rooms used by other events
  if (input.eventDate && !errors.length) {
    const ownIds = sessions.map(s => s._id).filter(Boolean);
    for (const s of sessions) {
      const clash = await guard.findClash(s.venue, input.eventDate, s.startTime, s.endTime, { eventId, sessionIds: ownIds });
      if (clash) {
        const v = venueMap[String(s.venue)];
        errors.push(`Selected venue ${v ? v.label : ''} is already booked for this time slot (${clash}).`);
      }
    }
  }
  return errors;
}


// persistence

async function syncSessions(event, sessions) {
  const existing = await repo.findSessionsByEvent(event._id);
  const keepIds = [];

  for (const s of sessions) {
    const data = {
      sessionTitle: s.sessionTitle, speaker: s.speaker, startTime: s.startTime, endTime: s.endTime,
      venue: s.venue, allocatedCapacity: s.allocatedCapacity
    };
    const found = s._id && existing.find(e => String(e._id) === String(s._id));
    if (found) {
      if (data.allocatedCapacity < found.bookedSeats) {
        throw new ServiceError(422, 'ERR_CAPACITY_BELOW_BOOKED',
          `"${found.sessionTitle}" already has ${found.bookedSeats} bookings, capacity cannot go below that.`);
      }
      Object.assign(found, data);
      await repo.saveSession(found);
      keepIds.push(String(found._id));
    } else {
      const created = await repo.createSession({ ...data, event: event._id, sessionId: await nextCode('SES') });
      keepIds.push(String(created._id));
    }
  }

  // removed rows: only allowed if nobody has booked them
  for (const e of existing) {
    if (!keepIds.includes(String(e._id))) {
      if (e.bookedSeats > 0) {
        throw new ServiceError(409, 'ERR_SESSION_HAS_BOOKINGS',
          `"${e.sessionTitle}" has bookings and cannot be removed. Cancel the event instead.`);
      }
      await repo.deleteSession(e);
    }
  }
}

function assertOwner(event, user) {
  if (user.role === 'ADMIN') return;
  if (String(event.coordinator) !== String(user._id)) {
    throw new ServiceError(403, 'ERR_NOT_OWNER', 'Only the coordinator who created this event can change it.');
  }
}

// submitting moves the event forward. a fresh draft goes to SUBMITTED, a corrected
// event goes straight back to UNDER_REVIEW ("update and resubmit" in diagram 43.1)
function statusAfterSubmit(event) {
  return event.status === EVENT_STATUS.REVISION_REQUIRED ? EVENT_STATUS.UNDER_REVIEW : EVENT_STATUS.SUBMITTED;
}

async function afterSubmit(event, user, resubmitted) {
  await dispatcher.notifyRole('APPROVER', 'REVIEW',
    resubmitted ? `"${event.title}" was corrected and resubmitted for review.` : `"${event.title}" was submitted for approval.`,
    `/approver/events/${event._id}`);
  await dispatcher.log(user._id, resubmitted ? 'RESUBMIT_EVENT' : 'SUBMIT_EVENT', event.eventId, event.title);
}


// public operations

// action: 'draft' | 'submit'
async function saveEvent({ user, eventId, body, action }) {
  const input = normaliseEventInput(body);
  const sessions = normaliseSessionsInput(body);
  let event = null;

  if (eventId) {
    event = await repo.findEventById(eventId);
    if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
    assertOwner(event, user);
    if (!EDITABLE_STATUSES.includes(event.status)) {
      throw new ServiceError(409, 'ERR_NOT_EDITABLE',
        `Events that are ${event.status.replace('_', ' ').toLowerCase()} cannot be edited.`);
    }
  }

  const isPublishedEdit = event && event.status === EVENT_STATUS.PUBLISHED;
  const errors = (action === 'submit' || isPublishedEdit)
    ? await validateForSubmission(input, sessions, event ? event._id : null)
    : validateDraft(input);

  if (isPublishedEdit && input.totalMaxCapacity) {
    const booked = await event.calculateTotalBookings();
    if (input.totalMaxCapacity < booked) errors.push(`Capacity cannot go below current registrations (${booked}).`);
  }
  if (errors.length) throw new ServiceError(400, 'ERR_VALIDATION_FAILED', errors[0], errors);

  const before = event ? {
    date: String(event.schedule.eventDate), startTime: event.schedule.startTime,
    endTime: event.schedule.endTime, venue: String(event.venue)
  } : null;

  if (!event) {
    event = repo.newEvent({ coordinator: user._id, eventId: await nextCode('EVT') });
  }
  applyInput(event, input);
  if (!event.schedule.scheduleId) event.schedule.scheduleId = await nextCode('SCH');

  let resubmitted = false;
  if (!isPublishedEdit) {
    if (action === 'submit') {
      resubmitted = event.status === EVENT_STATUS.REVISION_REQUIRED;
      event.status = statusAfterSubmit(event);
    } else if (event.status !== EVENT_STATUS.REVISION_REQUIRED) {
      event.status = EVENT_STATUS.DRAFT;
    }
  }
  await repo.saveEvent(event);
  await syncSessions(event, sessions);

  if (action === 'submit' && !isPublishedEdit) {
    await afterSubmit(event, user, resubmitted);
  } else if (isPublishedEdit) {
    // FR-038 tell registrants when something important changed
    const changed = before.date !== String(event.schedule.eventDate) || before.startTime !== event.schedule.startTime ||
      before.endTime !== event.schedule.endTime || before.venue !== String(event.venue);
    if (changed) {
      await dispatcher.notifyRegistrants(event._id, 'EVENT_UPDATE',
        `Schedule update for "${event.title}": now on ${fmtDate(event.schedule.eventDate)}, ${event.schedule.startTime}-${event.schedule.endTime}. Please check the details.`,
        `/events/${event._id}`);
    }
    await dispatcher.log(user._id, 'EDIT_PUBLISHED_EVENT', event.eventId, changed ? 'schedule/venue changed' : 'details changed');
  } else {
    await dispatcher.log(user._id, eventId ? 'UPDATE_DRAFT' : 'CREATE_DRAFT', event.eventId, event.title);
  }
  return event;
}

// submit an already saved draft without re-posting the form (API: PUT /events/:id/submit)
async function submitExisting(eventId, user) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  assertOwner(event, user);
  if (![EVENT_STATUS.DRAFT, EVENT_STATUS.REVISION_REQUIRED].includes(event.status)) {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'Only drafts can be submitted.');
  }
  const sessions = (await repo.findSessionsByEvent(event._id)).map(s => ({
    _id: s._id, sessionTitle: s.sessionTitle, startTime: s.startTime, endTime: s.endTime,
    venue: s.venue, allocatedCapacity: s.allocatedCapacity
  }));
  const errors = await validateForSubmission(inputFromEvent(event), sessions, event._id);
  if (errors.length) {
    const incomplete = errors.some(e => /Add at least/.test(e));
    throw new ServiceError(incomplete ? 412 : 400, incomplete ? 'ERR_INCOMPLETE_EVENT' : 'ERR_VALIDATION_FAILED', errors[0], errors);
  }
  const resubmitted = event.status === EVENT_STATUS.REVISION_REQUIRED;
  event.status = statusAfterSubmit(event);
  await repo.saveEvent(event);
  await afterSubmit(event, user, resubmitted);
  return event;
}

// API: add sessions to a draft (Event.addSession in the collaboration diagram)
async function addSessions(eventId, user, list) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Invalid eventId');
  assertOwner(event, user);
  if (![EVENT_STATUS.DRAFT, EVENT_STATUS.REVISION_REQUIRED].includes(event.status)) {
    throw new ServiceError(409, 'ERR_NOT_EDITABLE', 'Sessions can only be added to drafts.');
  }
  if (!list.length) throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Send an array of sessions.');

  const existing = await repo.findSessionsByEvent(event._id);
  const total = existing.reduce((t, s) => t + s.allocatedCapacity, 0) +
    list.reduce((t, s) => t + (parseInt(s.allocatedCapacity, 10) || 0), 0);
  if (event.totalMaxCapacity && total > event.totalMaxCapacity) {
    throw new ServiceError(422, 'ERR_CAPACITY_OVERFLOW', 'Sum of session capacities exceeds parent event limit.');
  }
  for (const s of list) {
    s.startTime = (s.startTime || '').slice(0, 5);
    s.endTime = (s.endTime || '').slice(0, 5);
    if (!s.sessionTitle || !s.venueId || toMinutes(s.startTime) >= toMinutes(s.endTime)) {
      throw new ServiceError(400, 'ERR_VALIDATION_FAILED', `Invalid session "${s.sessionTitle || ''}"`);
    }
    const own = existing.find(e => String(e.venue) === String(s.venueId) && e.checkTimeCollision(s.startTime, s.endTime));
    const other = event.schedule.eventDate &&
      await guard.findClash(s.venueId, event.schedule.eventDate, s.startTime, s.endTime, { eventId: event._id });
    if (own || other) throw new ServiceError(409, 'ERR_VENUE_COLLISION', `Venue double-booked for "${s.sessionTitle}".`);
  }
  const created = [];
  for (const s of list) {
    created.push(await repo.createSession({
      sessionId: await nextCode('SES'), event: event._id, sessionTitle: s.sessionTitle,
      sessionDescription: s.sessionDescription, startTime: s.startTime, endTime: s.endTime,
      venue: s.venueId, allocatedCapacity: parseInt(s.allocatedCapacity, 10)
    }));
  }
  return { event, created };
}

// approver side (UC-004 - showcase only in this prototype)

function pendingSubmissions() {
  return repo.findPendingEvents();
}

async function startReview(eventId, approver) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  if (event.status !== EVENT_STATUS.SUBMITTED) return event;
  event.status = EVENT_STATUS.UNDER_REVIEW;
  event.reviews.push({ reviewer: approver._id, decision: 'STARTED_REVIEW' });
  await repo.saveEvent(event);
  return event;
}

// decision: APPROVED | REJECTED | REVISION_REQUIRED (FR-013, BR-003)
async function decide(eventId, approver, decision, comments) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  if (![EVENT_STATUS.SUBMITTED, EVENT_STATUS.UNDER_REVIEW].includes(event.status)) {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'This event is not waiting for review.');
  }
  if (!['APPROVED', 'REJECTED', 'REVISION_REQUIRED'].includes(decision)) {
    throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Unknown decision.');
  }
  if (decision !== 'APPROVED' && !(comments || '').trim()) {
    throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'Please give a reason when rejecting or asking for changes.');
  }
  event.status = decision;
  event.reviews.push({ reviewer: approver._id, decision, comments: (comments || '').trim() });
  await repo.saveEvent(event);

  const msg = {
    APPROVED: `"${event.title}" was approved. You can publish it now.`,
    REJECTED: `"${event.title}" was rejected: ${comments}`,
    REVISION_REQUIRED: `"${event.title}" needs changes before approval: ${comments}`
  }[decision];
  await dispatcher.notifyUser(event.coordinator, 'REVIEW', msg, `/coordinator/events/${event._id}`);
  await dispatcher.log(approver._id, `REVIEW_${decision}`, event.eventId, comments);
  return event;
}

async function publish(eventId, user) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  assertOwner(event, user);
  if (!event.publish()) throw new ServiceError(409, 'ERR_INVALID_STATE', 'Only approved events can be published.');
  await repo.saveEvent(event);
  await dispatcher.log(user._id, 'PUBLISH_EVENT', event.eventId, event.title);
  return event;
}

async function cancel(eventId, user, reason) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  assertOwner(event, user);
  if (event.status === EVENT_STATUS.CANCELLED) return event;
  if (event.hasEnded()) throw new ServiceError(409, 'ERR_INVALID_STATE', 'This event is already over.');
  if (!(reason || '').trim()) throw new ServiceError(400, 'ERR_VALIDATION_FAILED', 'A cancellation reason is required.');

  const wasPublished = event.status === EVENT_STATUS.PUBLISHED;
  if (!event.cancel(reason)) {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'Only draft, submitted or published events can be cancelled.');
  }
  await repo.saveEvent(event);

  if (wasPublished) {
    // FR-040 tell everyone before we close their registrations
    await dispatcher.notifyRegistrants(event._id, 'CANCELLATION',
      `"${event.title}" on ${fmtDate(event.schedule.eventDate)} has been cancelled. Reason: ${event.cancelReason}`,
      `/events/${event._id}`);
    await registrations.cancelAllForEvent(event._id);
    await repo.resetSeats(event._id);
  }
  await dispatcher.log(user._id, 'CANCEL_EVENT', event.eventId, event.cancelReason);
  return event;
}

async function sendReminder(eventId, user) {
  const event = await repo.findEventById(eventId);
  if (!event) throw new ServiceError(404, 'ERR_EVENT_NOT_FOUND', 'Event not found.');
  assertOwner(event, user);
  if (event.status !== EVENT_STATUS.PUBLISHED) {
    throw new ServiceError(409, 'ERR_INVALID_STATE', 'Reminders can only be sent for published events.');
  }
  const note = event.eligibilityCriteria && event.eligibilityCriteria.description;
  const n = await dispatcher.notifyRegistrants(event._id, 'REMINDER',
    `Reminder: "${event.title}" is on ${fmtDate(event.schedule.eventDate)} at ${event.schedule.startTime}. ${note ? 'Note: ' + note.slice(0, 120) : ''}`.trim(),
    '/my/registrations');
  await dispatcher.log(user._id, 'SEND_REMINDER', event.eventId, `${n} recipients`);
  return n;
}

module.exports = {
  normaliseEventInput, normaliseSessionsInput, validateForSubmission, inputFromEvent,
  saveEvent, submitExisting, addSessions, pendingSubmissions, startReview, decide, publish, cancel,
  sendReminder, assertOwner
};
