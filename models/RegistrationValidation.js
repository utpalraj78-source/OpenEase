// PostgreSQL-backed RegistrationValidation Model
const { createModel } = require('../config/pgModel');
const { LEVEL_SATISFIES, ELIGIBILITY } = require('../config/constants');
const { fmtDateTime } = require('../utility/helpers');

function addError(v, code, message) {
  v.validationErrors = v.validationErrors || [];
  v.validationErrors.push({ code, message });
  v._doc.validationErrors = v.validationErrors;
  return false;
}

const methods = {
  checkEligibility(participant, criteria) {
    if (participant.participantType === 'PARENT') return true;
    const ok = LEVEL_SATISFIES[participant.eligibilityStatus] || ['GENERAL_PUBLIC'];
    const needed = (criteria && criteria.criteriaId) || 'GENERAL_PUBLIC';
    if (ok.includes(needed)) return true;
    return addError(this, 'ERR_INELIGIBLE_PARTICIPANT',
      `This event is for: ${ELIGIBILITY[needed]}. Your profile does not meet this. Update your profile if it is wrong.`);
  },

  checkWindowOpen(period, now = new Date()) {
    const start = period && period.registrationStart ? new Date(period.registrationStart) : null;
    const end = period && period.registrationEnd ? new Date(period.registrationEnd) : null;

    if (!period || !start || now < start) {
      return addError(this, 'ERR_REGISTRATION_WINDOW_CLOSED',
        `Registration opens on ${start ? fmtDateTime(start) : 'a later date'}.`);
    }
    if (end && now > end) {
      return addError(this, 'ERR_REGISTRATION_WINDOW_CLOSED',
        `Registration for this event closed on ${fmtDateTime(end)}.`);
    }
    return true;
  },

  checkConsents(body) {
    let ok = true;
    if (!body || !body.eligibilityConfirmed) {
      ok = addError(this, 'ERR_CONSENT_REQUIRED', 'You must confirm that your profile details and eligibility are accurate.');
    }
    if (!body || !body.termsAccepted) {
      ok = addError(this, 'ERR_CONSENT_REQUIRED', 'You must accept the open house visitor terms & conditions.');
    }
    return ok;
  },

  checkSessionCapacity(session) {
    if (!session) return true;
    if (session.isSeatAvailable && !session.isSeatAvailable()) {
      return addError(this, 'ERR_CAPACITY_EXCEEDED', 'Selected session has reached full allocated capacity.');
    }
    return true;
  },

  validateAll(participant, event, session) {
    this.validationErrors = [];
    this._doc.validationErrors = [];
    const okElig = this.checkEligibility(participant, event ? event.eligibilityCriteria : null);
    const okWin = this.checkWindowOpen(event ? event.registrationPeriod : null);
    const okCap = this.checkSessionCapacity(session);
    this.passed = okElig && okWin && okCap && (this.validationErrors.length === 0);
    this._doc.passed = this.passed;
    return this.passed;
  },

  runAll({ participant, event, session, body, now }) {
    this.validationErrors = [];
    this._doc.validationErrors = [];
    const okElig = this.checkEligibility(participant, event.eligibilityCriteria);
    const okWin = this.checkWindowOpen(event.registrationPeriod, now);
    const okCons = this.checkConsents(body);
    const okCap = this.checkSessionCapacity(session);
    this.passed = okElig && okWin && okCons && okCap && (this.validationErrors.length === 0);
    this._doc.passed = this.passed;
    return this.passed;
  }
};

const RegistrationValidation = createModel('registration_validations', methods, {}, {}, {
  validationErrors: [],
  passed: false
});

module.exports = RegistrationValidation;
