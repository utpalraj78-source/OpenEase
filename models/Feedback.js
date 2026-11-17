// PostgreSQL-backed Feedback Model
const { createModel } = require('../config/pgModel');

const Feedback = createModel('feedback');

module.exports = Feedback;
