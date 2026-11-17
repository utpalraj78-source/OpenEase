---
title: "OpenEase - Setup & Quickstart Guide"
subtitle: "CS314 Software Engineering Project | Pure PostgreSQL Architecture"
---

# 1. System Requirements

| Software | Required Version | Purpose |
|---|---|---|
| **Node.js** | v18.0.0 or higher (v20+ LTS recommended) | JavaScript runtime engine |
| **npm** | v9.0.0 or higher (bundled with Node.js) | Package manager |
| **Database** | **PostgreSQL (Embedded or External)** | Relational ACID database |
| **Web Browser** | Google Chrome, Microsoft Edge, or Mozilla Firefox | Presentation interface |

> [!NOTE]
> **Zero Database Installation Required for Local Development**:
> OpenEase includes an embedded WebAssembly PostgreSQL engine (`@electric-sql/pglite`) that runs directly inside Node.js and persists database records to disk in `./data/pglite`. You do **not** need to install or run MongoDB or external database servers.

---

# 2. Step-by-Step Installation

### Step 1: Install Node.js
1. Download the LTS installer from [nodejs.org](https://nodejs.org).
2. Run the installer with default settings (ensure **"Add to PATH"** is checked).
3. Verify the installation in your terminal:
   ```bash
   node -v
   npm -v
   ```

### Step 2: Extract or Clone the Project
Open a terminal in the project directory:
```bash
cd openease
```

### Step 3: Install Dependencies
Install all required production and development packages:
```bash
npm install
```

### Step 4: Environment Configuration
Create your local environment file:
* **Windows (PowerShell)**:
  ```powershell
  Copy-Item .env.example .env
  ```
* **Linux / macOS**:
  ```bash
  cp .env.example .env
  ```

> [!TIP]
> The default `.env` is pre-configured to use the embedded zero-config PostgreSQL engine. If you want to connect to an external PostgreSQL database (e.g., Supabase, Neon, AWS RDS, Docker, or local PostgreSQL), simply uncomment and set `DATABASE_URL=postgres://user:password@host:5432/dbname`.

---

# 3. Database Initialization & Seeding

Populate the PostgreSQL database with initial test users across all roles, campus venues, categories, sample open houses, and breakout sessions:

```bash
npm run seed
```

This creates the PostgreSQL schema tables (`users`, `events`, `sessions`, `registrations`, `attendance`, `feedback`, `audit_logs`, `session`) and provisions test data with password `pass1234`.

---

# 4. Running OpenEase

### Production Mode:
```bash
npm start
```

### Development Mode (with Live Reload):
```bash
npm run dev
```

Open your browser and navigate to:
[http://localhost:3000](http://localhost:3000)

---

# 5. Pre-Configured Test Accounts

All pre-seeded accounts share the password: `pass1234`

| Role | Email Address | Primary Use Cases |
|---|---|---|
| **Student** | `aarav@student.test` | Browse events, register, view QR pass, submit feedback |
| **Parent** | `meera@parent.test` | Register for campus tour with accompanying family guests |
| **Event Coordinator** | `coord.cse@openease.test` | Create events (5-step wizard), view rosters, mark attendance |
| **Coordinator (MBA)** | `coord.mba@openease.test` | Manage departmental business school events |
| **Event Approver (Dean)** | `approver@openease.test` | Review submissions, approve, reject, request revisions |
| **Institute Management** | `dean@openease.test` | High-level analytics, registration trends, attendance KPIs |
| **System Administrator** | `admin@openease.test` | User provisioning, role assignment, account status toggle, audit logs |

---

# 6. Executing Automated Test Suites

OpenEase provides a unified test runner:

```bash
npm test
```

You can also run individual testing suites independently:

```bash
# 1. Assignment 8 Test Suite (12 formal test cases - EP & BVA)
npm run test:assignment8

# 2. Smoke Test Suite (38 route, permission, and workflow checks)
npm run smoke

# 3. Security & Penetration Suite (13 injection, XSS, & privilege escalation checks)
npm run test:security

# 4. Concurrency & Load Stress Suite (100 parallel bookings & 200 burst requests)
npm run test:load

# 5. User Acceptance Testing (6 real-world persona journeys)
npm run test:uat

# 6. Code Coverage (c8 coverage report)
npm run test:coverage
```

---

# 7. Troubleshooting & FAQ

* **Port 3000 already in use**:
  Change `PORT=3001` in your `.env` file and restart.
* **Reset Database to clean state**:
  Run `npm run seed` at any time to re-initialize and re-seed all tables.
* **External PostgreSQL connection timeout**:
  Ensure your `DATABASE_URL` is accessible and your IP is allowed in cloud security group rules (e.g. Supabase or AWS RDS).
