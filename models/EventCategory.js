// PostgreSQL-backed EventCategory Model
const { createModel } = require('../config/pgModel');

const EventCategory = createModel('event_categories');

module.exports = EventCategory;
