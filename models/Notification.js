// PostgreSQL-backed Notification Model
const { createModel } = require('../config/pgModel');

const Notification = createModel('notifications');

module.exports = Notification;
