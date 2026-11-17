// all the enums in one place so models/views dont go out of sync

const ROLES = {
  STUDENT_PARENT: 'STUDENT_PARENT',
  COORDINATOR: 'COORDINATOR',
  APPROVER: 'APPROVER',
  ADMIN: 'ADMIN',
  MANAGEMENT: 'MANAGEMENT'
};

const ROLE_LABELS = {
  STUDENT_PARENT: 'Student / Parent',
  COORDINATOR: 'Event Coordinator',
  APPROVER: 'Event Approver',
  ADMIN: 'Administrator',
  MANAGEMENT: 'Institute Management'
};

// Event lifecycle (SRS sec 17 / state diagram 43.1)
const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED'
};

// statuses in which a coordinator may still edit the event (FR-009)
const EDITABLE_STATUSES = ['DRAFT', 'REVISION_REQUIRED', 'PUBLISHED'];

// registration states (state diagram 43.2)
const REG_STATUS = {
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  CORRECTION_REQUIRED: 'CORRECTION_REQUIRED',
  REGISTERED: 'REGISTERED',
  CANCELLED: 'CANCELLED'
};

// event can only be cancelled from these (state diagram 43.1)
const CANCELLABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'PUBLISHED'];

const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT'
};

const ELIGIBILITY = {
  GENERAL_PUBLIC: 'General public (anyone)',
  CLASS_12_STEM: 'Class 12 - Science stream',
  CLASS_12_ANY: 'Class 12 - any stream',
  CLASS_11_12: 'Class 11 or 12',
  TRANSFER: 'Transfer / lateral entry students'
};

// what each participant "level" satisfies
const LEVEL_SATISFIES = {
  CLASS_10: ['GENERAL_PUBLIC'],
  CLASS_11: ['GENERAL_PUBLIC', 'CLASS_11_12'],
  CLASS_12_SCIENCE: ['GENERAL_PUBLIC', 'CLASS_12_STEM', 'CLASS_12_ANY', 'CLASS_11_12'],
  CLASS_12_COMMERCE: ['GENERAL_PUBLIC', 'CLASS_12_ANY', 'CLASS_11_12'],
  CLASS_12_ARTS: ['GENERAL_PUBLIC', 'CLASS_12_ANY', 'CLASS_11_12'],
  DIPLOMA_GRADUATE: ['GENERAL_PUBLIC', 'TRANSFER'],
  OTHER: ['GENERAL_PUBLIC']
};

const LEVEL_LABELS = {
  CLASS_10: 'Class 10',
  CLASS_11: 'Class 11',
  CLASS_12_SCIENCE: 'Class 12 (Science)',
  CLASS_12_COMMERCE: 'Class 12 (Commerce)',
  CLASS_12_ARTS: 'Class 12 (Arts)',
  DIPLOMA_GRADUATE: 'Diploma / Graduate',
  OTHER: 'Other'
};

// "intended academic program" dropdown on the register screen (UI-02, optional)
const PROGRAMS = ['B.Tech Computer Engineering', 'B.Tech Information Technology', 'B.Tech Electronics & Communication',
  'B.Tech Mechanical', 'B.Tech Civil', 'BBA', 'B.Com', 'B.Sc', 'Not decided yet'];

module.exports = {
  PROGRAMS,
  ROLES, ROLE_LABELS, EVENT_STATUS, EDITABLE_STATUSES, CANCELLABLE_STATUSES, REG_STATUS,
  ATTENDANCE_STATUS, ELIGIBILITY, LEVEL_SATISFIES, LEVEL_LABELS
};
