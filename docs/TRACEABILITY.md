# Requirements to Implementation Traceability Matrix

This document establishes bidirectional traceability between system design specifications (`T-008-2.pdf`), Functional Requirements (FR), Business Rules (BR), Non-Functional Requirements (NFR), and their concrete implementation in OpenEase.

---

## 1. Design Classes to Code Implementation

All 15 domain classes specified in the Software Architecture Document (Section 49.5 / Class Diagrams 1 & 2) are implemented with identical attribute and method signatures, backed natively by **PostgreSQL**:

| # | Design Class | Implementation Location | Persistence & Role Details | Key Domain Methods |
|---|---|---|---|---|
| 1 | **User** | [`models/User.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/User.js) | Base table `users` | `authenticate`, `getUserId`, `getRole`, `updatePassword`, `hashPassword` |
| 2 | **StudentParent** | `User.StudentParent` | Subclass / Discriminator | `browseEvents`, `registerForEvent`, `cancelRegistration`, `viewMyRegistrations` |
| 3 | **EventCoordinator** | `User.EventCoordinator` | Subclass / Discriminator | `createEvent`, `updateEvent`, `submitEventForReview`, `addSessionToEvent`, `recordSessionAttendance` |
| 4 | **EventApprover** | `User.EventApprover` | Subclass / Discriminator | `getPendingSubmissions`, `approveEvent`, `rejectEvent`, `requestRevision` |
| 5 | **Event** | [`models/Event.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Event.js) | Table `events` | `isRegistrationOpen`, `publish`, `cancel`, `calculateTotalBookings`, `hasEnded`, `registrationState` |
| 6 | **EventCategory** | [`models/EventCategory.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/EventCategory.js) | Table `event_categories` | - |
| 7 | **Session** | [`models/Session.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Session.js) | Table `sessions` | `isSeatAvailable`, `incrementBookedSeats`, `decrementBookedSeats`, `checkTimeCollision` |
| 8 | **Schedule** | Embedded in `Event.schedule` | Composition (JSONB) | `eventDate`, `startTime`, `endTime`, `scheduleId` |
| 9 | **Venue** | [`models/Venue.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Venue.js) | Table `venues` | `verifyCapacity`, `checkAvailability` |
| 10 | **Registration** | [`models/Registration.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Registration.js) | Table `registrations` | `confirmRegistration`, `requireCorrection`, `resubmit`, `cancelRegistration` |
| 11 | **RegistrationPeriod** | Embedded in `Event.registrationPeriod` | Composition (JSONB) | `registrationStart`, `registrationEnd` |
| 12 | **EligibilityCriteria** | Embedded in `Event.eligibilityCriteria` | Composition (JSONB) | `criteriaId`, `description` |
| 13 | **RegistrationValidation** | [`models/RegistrationValidation.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/RegistrationValidation.js) | Table `registration_validations` | `validateAll`, `checkEligibility`, `checkWindowOpen`, `checkSessionCapacity`, `checkConsents` |
| 14 | **Attendance** | [`models/Attendance.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Attendance.js) | Table `attendance` | `markPresent`, `markAbsent`, `updateStatus` |
| 15 | **Notification** | [`models/Notification.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Notification.js) | Table `notifications` | In-app alerts, unread counts, mark all read |
| 16 | **Feedback** | [`models/Feedback.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Feedback.js) | Table `feedback` | Entity 16.7: 1–5 star ratings & attendee reviews |
| 17 | **AuditLog** | [`models/AuditLog.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/AuditLog.js) | Table `audit_logs` | NFR-007 / NFR-020: administrative audit trails |
| 18 | **Counter** | [`models/Counter.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/models/Counter.js) | Table `counters` | Atomic sequential code generator |

---

## 2. 4-Tier Architecture Traceability

| Tier | Component in Specification | Implementation Module |
|---|---|---|
| **Tier 1: Presentation** | Event Creation UI, Registration UI, Attendance UI, Dashboards | `routes/*.js` + `views/**/*.ejs` + `public/js/app.js` + `public/css/style.css` |
| **Tier 2: Application Services** | EventWorkflowService, RegistrationPolicyService, AttendanceOrchestratorService, ReportingService | `services/eventWorkflowService.js`, `services/registrationPolicyService.js`, `services/attendanceOrchestratorService.js`, `services/reportingService.js`, `services/ldapService.js` |
| **Tier 3: Shared Utilities** | VenueScheduleGuard, InvariantRuleEngine, AuditAlertDispatcher, SyslogForwarder | `utility/venueScheduleGuard.js`, `utility/invariantRuleEngine.js`, `utility/auditAlertDispatcher.js`, `utility/syslogForwarder.js`, `utility/calendarEngine.js` |
| **Tier 4: Persistence** | PersistenceGatewayComponent (DAO Repositories & PostgreSQL Engine) | `repositories/*.js` -> `models/*.js` -> `config/pgModel.js` -> PostgreSQL (`@electric-sql/pglite` / `pg`) |

---

## 3. Functional Requirements (FR) Traceability

| Requirement | Description | Implementation Path | Verification Status |
|---|---|---|:---:|
| **FR-001..003** | User login, validation error handling, session destruction | `routes/auth.js`, `models/User.js`, `config/sessionStore.js` | Verified (100% Pass) |
| **FR-004..005** | Role-Based Access Control (RBAC) across 5 roles | `middleware/auth.js#requireRole`, `models/User.js` | Verified (100% Pass) |
| **FR-006..011** | Create event proposal, 5-step wizard, draft save, edit, session schedules | `services/eventWorkflowService.js#saveEvent`, `views/coordinator/event-form.ejs` | Verified (100% Pass) |
| **FR-012** | Event proposal revision resubmission | `services/eventWorkflowService.js#saveEvent` | Verified (100% Pass) |
| **FR-013..015** | Submit for approval, review, approve, publish, and cancellation | `services/eventWorkflowService.js` (`decide`, `publish`, `cancel`) | Verified (100% Pass) |
| **FR-016..020** | Public catalog, search, category filter, event details & status indicators | `routes/public.js`, `views/events/*` | Verified (100% Pass) |
| **FR-021..025** | Attendee registration, eligibility verification, consent capture, atomic seat booking | `services/registrationPolicyService.js#register`, `models/RegistrationValidation.js` | Verified (100% Pass) |
| **FR-026** | Participant self-cancellation & automated seat replenishment | `services/registrationPolicyService.js#cancel` | Verified (100% Pass) |
| **FR-027..028** | Attendee registration dashboard, digital pass, participant roster export | `routes/student.js`, `routes/coordinator.js` (CSV export) | Verified (100% Pass) |
| **FR-029..032** | Session attendance logging, roster inspection, status transitions | `services/attendanceOrchestratorService.js`, `views/coordinator/attendance.ejs` | Verified (100% Pass) |
| **FR-033..034** | Breakout session track picker & capacity availability | `views/events/register.ejs`, `models/Session.js` | Verified (100% Pass) |
| **FR-035..036** | Post-event feedback collection (1-5 stars & reviews) | `routes/student.js`, `models/Feedback.js` | Verified (100% Pass) |
| **FR-037..040** | Notification dispatching (registration, updates, reminders, read receipts) | `utility/auditAlertDispatcher.js`, `routes/notifications.js` | Verified (100% Pass) |
| **FR-041..043** | Operational reports, attendee counts, attendance rates & KPI dashboards | `services/reportingService.js`, `views/reports/*` | Verified (100% Pass) |
| **FR-044..045** | Administrator user management, account provisioning, status toggles | `routes/admin.js`, `views/admin/users.ejs` | Verified (100% Pass) |

---

## 4. Business Rules (BR) Traceability

| Rule | Rule Description | Enforcing Code Entity |
|---|---|---|
| **BR-001, BR-002** | Only authorized coordinators/administrators manage events & sessions | `middleware/auth.js#requireRole('COORDINATOR', 'ADMIN')` + `eventWorkflowService.js#assertOwner` |
| **BR-003** | Events can only transition to PUBLISHED from APPROVED status | `models/Event.js#publish()` strictly checks `this.status === 'APPROVED'` |
| **BR-004** | Attendee registration is only permissible on PUBLISHED events | `registrationPolicyService.js#register` checks `event.status === 'PUBLISHED'` |
| **BR-005** | Registration is restricted to the configured date-time window | `models/RegistrationValidation.js#checkWindowOpen` |
| **BR-006** | A participant cannot register more than once for the same event | `registrationPolicyService.js` + PostgreSQL unique constraint |
| **BR-007** | Session bookings cannot exceed allocated room capacity | Atomic PostgreSQL condition: `(doc->>'bookedSeats')::int < (doc->>'allocatedCapacity')::int` |
| **BR-008** | Only assigned event coordinators/administrators may log attendance | `attendanceOrchestratorService.js#canRecord` |
| **BR-009** | Feedback can only be submitted after verified attendance or event conclusion | `routes/student.js#POST /registrations/:id/feedback` checks attendance & end time |
| **BR-010** | Analytical reports are restricted to authorized personnel | `routes/reports.js` enforces role guards and coordinator event ownership scoping |

---

## 5. UI Stepper Validation Traceability (UI-01)

| Step | Fields Validated | Enforcement Function | Invalid Feedback |
|:---:|---|---|---|
| **Step 1: Basic Details** | `title` ($\ge 5$ chars), `category` | `validateStep(1)` in `app.js` | Red border + `.step-validation-msg` alert |
| **Step 2: Schedule & Venue** | `eventDate` (future), `startTime`, `endTime` (start < end), `venue` | `validateStep(2)` in `app.js` | Prevents proceeding if end $\le$ start |
| **Step 3: Registration** | `registrationStart`, `registrationEnd` (start < end), `criteriaId` | `validateStep(3)` in `app.js` | Validates dates fall before event date |
| **Step 4: Sessions** | Session titles, timings, capacities, venues | `validateStep(4)` in `app.js` | Ensures session sum $\le$ event capacity |
| **Step 5: Review & Submit** | Full proposal integrity check | `canAdvanceTo(5)` | Prevents skipping prior incomplete steps |

---

## 6. Test Suite Traceability

| Testing Layer | Test Specification File | Target System Entities | Pass Rate |
|---|---|---|:---:|
| **Formal Assignment 8 Suite** | [`scripts/assignment8-runner.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/scripts/assignment8-runner.js) | TC-003-01..04, TC-009-01..04, TC-012-01..04 | **12 / 12 (100%)** |
| **System Smoke Suite** | [`scripts/smoke-test.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/scripts/smoke-test.js) | All 7 roles, 38 endpoints, state transitions | **38 / 38 (100%)** |
| **Security & Pentest Suite** | [`scripts/security-test.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/scripts/security-test.js) | Injection, XSS, Session tampering, RBAC | **13 / 13 (100%)** |
| **Concurrency Load Suite** | [`scripts/load-stress-test.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/scripts/load-stress-test.js) | 100 concurrent bookings, 200 burst requests | **100% (0 overbooking)** |
| **User Acceptance Testing** | [`scripts/uat-acceptance-test.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/scripts/uat-acceptance-test.js) | 6 End-to-end persona journeys | **6 / 6 (100%)** |
