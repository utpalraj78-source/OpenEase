# OpenEase - Open House Event Management System

OpenEase is an institutional event management web application developed in accordance with the Software Requirements Specification and System Architecture documentation (`T-008-2.pdf`, Assignments 1 through 8).

The system manages the full lifecycle of university open houses, including event proposals, administrative approval workflows, public catalogs, concurrency-safe attendee registrations, digital QR passes, live session attendance tracking, post-event feedback, and analytical reporting.

---

## Key Features & In-Scope Use Cases

* **UC-001**: User Authentication & Self-Registration (Sign-up, login, logout, session management)
* **UC-002**: Administrator User Management (`/admin/users`, role assignment, account status toggle, password reset)
* **UC-003**: Create and Submit Event Proposal (5-step wizard with sequential validation, draft saving, venue collision checks, session scheduling)
* **UC-004**: Review & Approve Event (Approver queue, approve, reject, request revision with comments)
* **UC-005**: Manage Event and Sessions (Edit draft/details, session configuration, event cancellation)
* **UC-006**: Publish Event (Publish approved events, opening attendee registrations)
* **UC-007**: Browse Events (Public catalogue of open house events)
* **UC-008**: Search & Filter Events (Keyword search, category and eligibility filters)
* **UC-009**: Register for Event (Attendee registration, session track picker, concurrency-safe atomic seat reservation)
* **UC-010**: Cancel Registration (Attendee self-cancellation with seat replenishment)
* **UC-011**: View Registration (Booking pass, digital receipt, attendance status)
* **UC-012**: Record Attendance (Session attendance terminal, present/absent batch logging)
* **UC-013**: Select Sessions (Session track picker integrated into registration)
* **UC-014**: Submit Post-Event Feedback (1–5 star rating and comments after attendance/event completion)
* **UC-015**: Notifications (In-app alerts, schedule update broadcasts, event reminders, mark all as read)
* **UC-016**: Generate Reports & Export (Registration and attendance metrics, participant roster CSV download, feedback summaries)

---

## Technical Stack

* **Runtime & Backend**: Node.js (v18+ LTS) + Express 4.x
* **Primary Database**: **PostgreSQL (Hybrid Architecture)**
  * **Zero-Config Local Mode**: In-process WebAssembly PostgreSQL (`@electric-sql/pglite`) persisting to disk in `./data/pglite`. No separate database server required.
  * **Production Mode**: Connects to any external PostgreSQL instance (`pg.Pool`) via `DATABASE_URL` (Supabase, Neon, AWS RDS, Docker, local Postgres).
* **Session Store**: `express-session` + `connect-pg-simple` on PostgreSQL `session` table.
* **Security & Encryption**: `bcryptjs` salted password hashing, `httpOnly` signed session cookies.
* **Templating & UI**: EJS templates with custom CSS (no external front-end framework dependencies).
* **Barcodes & Calendars**: `qrcode` (2D QR barcode tickets) + RFC 5545 iCalendar engine (`.ics`).

---

## Quickstart & Setup

### 1. Prerequisites
* Node.js v18.0.0 or higher ([nodejs.org](https://nodejs.org))
* npm (bundled with Node.js)
* **No external database server needed** (embedded PostgreSQL is bundled)

### 2. Installation
```bash
cd openease
npm install
```

### 3. Environment Configuration
Copy the sample environment file:
```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

### 4. Database Seeding
Initialize PostgreSQL tables and seed sample accounts, events, and venues:
```bash
npm run seed
```

### 5. Start Application
```bash
# Production server
npm start

# Development server (with live reload)
npm run dev
```

Open your browser at: [http://localhost:3000](http://localhost:3000)

---

## Pre-Configured Test Accounts

All demo accounts share the password: **`pass1234`**

| Role | Email Address | Access Level |
|---|---|---|
| **Student** | `aarav@student.test` | Student Portal, Event Registration, Digital Pass |
| **Parent** | `meera@parent.test` | Parent Registration with Accompanying Family Guests |
| **Event Coordinator** | `coord.cse@openease.test` | Event Proposal Wizard, Session Rosters, Attendance |
| **Coordinator (MBA)** | `coord.mba@openease.test` | Business School Event Coordination |
| **Event Approver (Dean)** | `approver@openease.test` | Proposal Queue, Approval / Rejection Workflow |
| **Institute Management** | `dean@openease.test` | Analytical Reports, Attendance & Registration KPIs |
| **System Administrator** | `admin@openease.test` | User Management, Status Toggles, Syslog Audit Stream |

---

## Automated Test Suites

Run the unified regression test suite:
```bash
npm test
```

Or run individual testing layers:

```bash
# 1. Assignment 8 Suite (12 formal test cases - EP & BVA)
npm run test:assignment8

# 2. System Smoke Suite (38 route, permission, and workflow checks)
npm run smoke

# 3. Security & Vulnerability Suite (13 injection, XSS, & privilege escalation checks)
npm run test:security

# 4. Load & Concurrency Stress Suite (100 parallel bookings & 200 burst requests)
npm run test:load

# 5. User Acceptance Testing (6 real-world persona journeys)
npm run test:uat

# 6. Code Coverage Report (c8 statement & branch coverage)
npm run test:coverage
```

### Concurrency Benchmark Summary:
* **Race Condition Test**: 100 simultaneous booking requests for 5 seats &rarr; exactly 5 seats allocated, 95 rejected (`422 Capacity Exceeded`), **0 overbooking**.
* **High-Throughput Read Burst**: 200 burst requests &rarr; **100% 200 OK** at ~96 ms average latency.

---

## Documentation Links

* [docs/DEPLOYMENT.md](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/docs/DEPLOYMENT.md) — Cloud deployment guide (Render, Railway, Supabase, Neon, Docker, VPS).
* [docs/HOW-IT-WORKS.md](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/docs/HOW-IT-WORKS.md) — Deep architectural walkthrough, 4-tier design, and atomic concurrency locking.
* [docs/SETUP.md](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/docs/SETUP.md) — Step-by-step developer installation and troubleshooting guide.
* [docs/TRACEABILITY.md](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/docs/TRACEABILITY.md) — Full requirements, business rules, design classes, and test case mapping matrix.
