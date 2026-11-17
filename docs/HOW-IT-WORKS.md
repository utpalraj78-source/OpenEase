---
title: "OpenEase - How It Works"
subtitle: "Comprehensive System Architecture, Feature Implementation & Technical Design"
---

# 1. System Overview

OpenEase is an institutional **Open House Event Management System** developed in strict alignment with the Software Requirements Specification (SRS) and System Architecture documentation (`T-008-2.pdf`, Assignments 1 to 8).

The platform facilitates the complete lifecycle of campus open houses—from initial proposal and administrative review to public catalog discovery, concurrency-safe attendee registration, digital QR pass issuance, live session attendance tracking, post-event feedback collection, and automated analytical reporting.

---

# 2. System Architecture (4-Tier Design)

OpenEase strictly follows the **4-Tier Layered Architecture Pattern** specified in design documentation (Section 50.6):

```
                   Browser Client (HTML5 / EJS / Responsive Vanilla JS)
                                            │
  TIER 1: Presentation Tier                │ (HTTP / Session Cookie)
                                            ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  routes/*.js  &  views/*.ejs                                                │
  │  - Auth Router (/login, /register, /logout)                                 │
  │  - Public Portal (/events, /events/:id)                                     │
  │  - Student Portal (/my/registrations, /my/registrations/:id/calendar.ics)   │
  │  - Coordinator Portal (/coordinator, /coordinator/events/new, /attendance)  │
  │  - Approver Portal (/approver, /approver/events/:id/decision)               │
  │  - Reports & Administration (/reports, /admin/users, /admin/syslog)         │
  │                                                                             │
  │  Middleware Guards:                                                         │
  │  - auth.js (Authentication & Role-Based Access Control)                    │
  │  - sessionStore.js (PostgreSQL session state & CSRF mitigation)             │
  │  - flash.js (User alert messaging queue)                                    │
  └─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
  TIER 2: Application Services Tier     │ Calls domain workflows
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  services/eventWorkflowService.js         (Event lifecycle, drafts, review)  │
  │  services/registrationPolicyService.js    (Attendee registration & quotas) │
  │  services/attendanceOrchestratorService.js (Session check-in & rosters)      │
  │  services/reportingService.js             (Metrics, CSV exports & KPIs)     │
  │  services/ldapService.js                  (Institutional LDAP directory)    │
  └─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
  TIER 3: Shared Utilities & Domain     │ Enforces invariants & business rules
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  utility/invariantRuleEngine.js    (BR-005 window, BR-006 dupes, BR-007 seat)│
  │  utility/venueScheduleGuard.js     (Room clash detection & capacity checks)  │
  │  utility/auditAlertDispatcher.js   (NFR-007 audit logs & notifications)     │
  │  utility/syslogForwarder.js        (RFC 5424 central syslog streaming)       │
  │  utility/calendarEngine.js         (RFC 5545 .ics iCalendar export)          │
  │  utility/qrCodeGenerator.js        (Scannable 2D QR booking pass generation) │
  └─────────────────────────────────────┬───────────────────────────────────────┘
                                        │
  TIER 4: Persistence Tier              │ PostgreSQL Data Access
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  repositories/*.js -> models/*.js -> PostgreSQL                             │
  │  - Pure PostgreSQL database engine (No MongoDB)                            │
  │  - Hybrid persistence: embedded @electric-sql/pglite OR external pg.Pool   │
  │  - Atomic SQL row-locking: UPDATE sessions SET booked_seats = booked_seats+1│
  │  - Session store: connect-pg-simple on PostgreSQL "session" table           │
  └─────────────────────────────────────────────────────────────────────────────┘
```

---

# 3. Technology Stack & Design Decisions

| Component | Technology | Rationale |
|---|---|---|
| **Runtime & Web Engine** | Node.js (LTS) + Express 4.x | Fast, non-blocking I/O event loop ideal for concurrent web traffic and lightweight deployment. |
| **Primary Database** | **PostgreSQL (Hybrid)** | Full relational ACID guarantees, atomic conditional update capabilities, and alignment with course specification. |
| **Local Zero-Config DB** | `@electric-sql/pglite` | In-process WebAssembly PostgreSQL engine running inside Node.js; writes directly to disk in `./data/pglite`. Zero external DB setup required. |
| **Cloud DB Connectivity** | `pg` (Node-Postgres) Connection Pool | Automatically activates when `DATABASE_URL` is set in `.env` (Supabase, Neon, AWS RDS, Render, Railway). |
| **Session Persistence** | `connect-pg-simple` | Secure, signed server-side session management stored directly in PostgreSQL's `session` table with automatic TTL cleanup. |
| **Template Engine** | EJS (Embedded JavaScript) | Clean server-rendered HTML5 views without bulky front-end framework build steps. |
| **Security & Auth** | `bcryptjs` + HMAC signed cookies | Industry-standard salted password hashing with `httpOnly` and `SameSite: lax` security flags. |
| **Styling & Presentation** | Handcrafted CSS | Custom corporate styling without third-party design dependencies, ensuring pixel-perfect fidelity. |
| **Barcode & Calendar** | `qrcode` + custom RFC 5545 engine | Native in-process generation of scannable 2D QR tickets and standard calendar attachments. |

---

# 4. Domain Model: 15 Design Classes Mapped to PostgreSQL

Every class from the class diagram exists in `models/` with identical attribute and method signatures:

```
                 User  (userId, fullName, email, passwordHash, role, accountStatus)
                /       |        \
     StudentParent  EventCoordinator  EventApprover        <- Role Discriminators
           |              | creates          | reviews
           |              v                  v
           |            Event ------------------------+
           |   (eventId, title, totalMaxCapacity, status)
           |     |  contains 1..*     | composed of (embedded JSON):
           |     v                    |   Schedule, RegistrationPeriod, EligibilityCriteria
           |   Session -- held at --> Venue
           |     ^                    EventCategory
           |     |
           +--> Registration --validated by--> RegistrationValidation
                      |
                      +--> Attendance          Notification  (sent to User)
                      |
                      +--> Feedback            AuditLog      (system audit trail)
```

### Class Responsibilities & Methods:
1. **`User`**: Base identity entity (`authenticate`, `getUserId`, `getRole`, `updatePassword`, `hashPassword`).
2. **`StudentParent`**: Inherits from `User` (`browseEvents`, `registerForEvent`, `cancelRegistration`, `viewMyRegistrations`).
3. **`EventCoordinator`**: Inherits from `User` (`createEvent`, `updateEvent`, `submitEventForReview`, `addSessionToEvent`, `recordSessionAttendance`).
4. **`EventApprover`**: Inherits from `User` (`getPendingSubmissions`, `approveEvent`, `rejectEvent`, `requestRevision`).
5. **`Event`**: Aggregate root (`isRegistrationOpen`, `publish`, `cancel`, `calculateTotalBookings`, `hasEnded`, `registrationState`).
6. **`Session`**: Breakout session with capacity guard (`isSeatAvailable`, `incrementBookedSeats`, `decrementBookedSeats`, `checkTimeCollision`).
7. **`Venue`**: Campus facility management (`verifyCapacity`, `checkAvailability`).
8. **`EventCategory`**: Departmental classification (`Undergraduate`, `Campus Showcase`, `Postgraduate`).
9. **`Registration`**: Attendee booking lifecycle (`confirmRegistration`, `requireCorrection`, `resubmit`, `cancelRegistration`).
10. **`RegistrationValidation`**: Tier 3 invariant checker (`validateAll`, `checkEligibility`, `checkWindowOpen`, `checkSessionCapacity`, `checkConsents`).
11. **`Attendance`**: Session attendance log (`markPresent`, `markAbsent`, `updateStatus`).
12. **`Feedback`**: Post-event attendee reviews and 1–5 star ratings.
13. **`Notification`**: In-app alert dispatching with unread tracking.
14. **`AuditLog`**: Tamper-evident administrative audit log stream.
15. **`Counter`**: Sequential code generator (`EVT-1001`, `SES-101`, `REG-480001`, `ATT-700001`, `FDB-1001`).

---

# 5. Core Workflows & Invariant Rules

### A. 5-Step Event Proposal Wizard & Sequential Step Validation
The coordinator event form (`views/coordinator/event-form.ejs`) is split into 5 structured steps:
1. **Basic Details**: Title (min 5 chars), Category, Description, Organizer.
2. **Schedule & Venue**: Event Date (future), Start/End times (Start < End), Meeting Venue (capacity verification).
3. **Registration & Eligibility**: Registration window (Start < End < Event Date), Visitor criteria.
4. **Breakout Sessions**: Multi-session track configuration (session timings inside event window, sum of capacities $\le$ total capacity, venue clash check).
5. **Review & Submit**: Summary preview with conditional submission.

> **Sequential Stepper Enforcement**:
> In [`public/js/app.js`](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/public/js/app.js), `validateStep(n)` and `canAdvanceTo(target)` strictly lock subsequent steps. Clicking Step 2 before Step 1 is valid, Step 3 before Steps 1 & 2 are valid, or jumping to Step 5 prematurely is prevented with visual validation highlights (`.field-invalid`, `.step-validation-msg`).

### B. Concurrency-Safe Seat Reservation (Zero Overbooking)
In high-demand open house sessions, multiple attendees may attempt to book the last available seat simultaneously.
OpenEase executes an **atomic conditional SQL update directly in PostgreSQL**:
```sql
UPDATE sessions 
SET booked_seats = booked_seats + 1,
    doc = jsonb_set(doc, '{bookedSeats}', to_jsonb((doc->>'bookedSeats')::int + 1)),
    updated_at = NOW()
WHERE id = $1 AND (doc->>'bookedSeats')::int < (doc->>'allocatedCapacity')::int
RETURNING doc;
```
If two requests execute concurrently for the final remaining seat:
- Exactly **one transaction succeeds** and returns the updated record.
- The competing transaction updates **0 rows**, immediately triggering `422 ERR_CAPACITY_EXCEEDED` with rollback and zero overbooking.

### C. Attendance Check-in & QR Code Verification
1. Each registration generates a unique cryptographic reference and scannable 2D QR barcode (`/my/registrations/:id/qr.png`).
2. Event coordinators open the live Session Attendance Terminal (`/coordinator/sessions/:id/attendance`).
3. Coordinators mark attendees `PRESENT` or `ABSENT` individually or via batch commit.
4. Only participants who have been verified as `PRESENT` (or after the event has officially concluded) are permitted to submit post-event feedback (Rule BR-009).

---

# 6. Automated Testing Verification

OpenEase includes a 5-tier automated testing suite executable via:
```bash
npm test
```

1. **Assignment 8 Test Runner** (`npm run test:assignment8`): Executes 12 formal test cases (TC-003-01 to TC-012-04) using Equivalence Partitioning and Boundary Value Analysis.
2. **Smoke Regression Suite** (`npm run smoke`): 38 end-to-end checks covering every route, role permission, and HTTP status code.
3. **Security & Penetration Suite** (`npm run test:security`): 13 security assertions verifying NoSQL/SQL injection prevention, XSS escaping, `httpOnly` cookie flags, session tampering rejection, and privilege escalation blocks.
4. **Load & Concurrency Stress Suite** (`npm run test:load`):
   - Fired 100 concurrent parallel booking requests for a session with strictly 5 seats: exactly 5 succeeded, 95 rejected (`422`), **0 overbooking**.
   - Fired 200 burst requests: **100% 200 OK** at ~96 ms average latency.
5. **User Acceptance Testing** (`npm run test:uat`): 6 real-world persona journeys validating stories for Coordinators, Approvers, Students, Parents, Staff, and Administrators.
