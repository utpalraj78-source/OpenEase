// tier 3: Invariant Rule Engine (eligibility + duplicate + window + capacity checker)
// creates a RegistrationValidation object, runs validateAll() and saves the result
const RegistrationValidation = require('../models/RegistrationValidation');
const { nextCode } = require('../models/Counter');

async function validateRegistration(registration, participant, event, session) {
  const v = new RegistrationValidation({ validationId: await nextCode('VAL'), registration: registration._id });
  await v.validateAll(participant, event, session);
  await v.save();
  return v;
}

module.exports = { validateRegistration };
