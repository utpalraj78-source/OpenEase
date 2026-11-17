// services throw this, routes show it as flash msg (web) or json (api)
class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;   // array of field messages, used by forms
  }
}

module.exports = ServiceError;
