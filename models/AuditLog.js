// PostgreSQL-backed AuditLog Model
const { createModel } = require('../config/pgModel');

const AuditLog = createModel('audit_logs');

module.exports = AuditLog;
