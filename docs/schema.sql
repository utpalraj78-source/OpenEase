-- OpenEase - PostgreSQL Relational Database Schema Specification
-- Reference: T-008-2.pdf Section 49.5, Section 50.3.4, and Tier 4 PersistenceGatewayComponent

-- gen_random_uuid() is built-in in modern PostgreSQL (13+)

-- 1. Users Table (Entity 16.1)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. USR-1001
    full_name VARCHAR(80) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('STUDENT_PARENT', 'COORDINATOR', 'APPROVER', 'MANAGEMENT', 'ADMIN')),
    account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'DISABLED')),
    last_login_at TIMESTAMPTZ,
    -- Student/Parent specific attributes
    participant_id VARCHAR(20) UNIQUE,
    contact_phone VARCHAR(15),
    current_institution VARCHAR(120),
    eligibility_status VARCHAR(30) DEFAULT 'OTHER',
    participant_type VARCHAR(20) CHECK (participant_type IN ('STUDENT', 'PARENT')),
    -- Staff specific attributes
    coordinator_id VARCHAR(20) UNIQUE,
    approver_id VARCHAR(20) UNIQUE,
    department VARCHAR(80),
    office_room VARCHAR(40),
    department_scope VARCHAR(80),
    administrative_rank VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Event Categories (Entity 16.2 reference)
CREATE TABLE event_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id VARCHAR(20) UNIQUE NOT NULL,
    category_name VARCHAR(80) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Venues Table (Entity 16.3 reference)
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id VARCHAR(20) UNIQUE NOT NULL,
    building_name VARCHAR(80) NOT NULL,
    room_number VARCHAR(40) NOT NULL,
    seating_capacity INTEGER NOT NULL CHECK (seating_capacity > 0),
    has_projector BOOLEAN NOT NULL DEFAULT true,
    is_operational BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (building_name, room_number)
);

-- 4. Events Table (Entity 16.2)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. EVT-1001
    title VARCHAR(150) NOT NULL CHECK (char_length(title) >= 5),
    description TEXT,
    category_id UUID REFERENCES event_categories(id) ON DELETE SET NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE RESTRICT,
    coordinator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organizer VARCHAR(100),
    total_max_capacity INTEGER NOT NULL CHECK (total_max_capacity > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUIRED', 'APPROVED', 'PUBLISHED', 'CANCELLED'
    )),
    -- Schedule (Composition)
    schedule_id VARCHAR(20),
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL CHECK (end_time > start_time),
    -- Registration Period (Composition)
    reg_start_date TIMESTAMPTZ,
    reg_end_date TIMESTAMPTZ,
    -- Eligibility Criteria (Composition)
    criteria_id VARCHAR(40) NOT NULL DEFAULT 'GENERAL_PUBLIC',
    criteria_description TEXT,
    cancel_reason TEXT,
    published_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Sessions Table (Entity 16.3)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. SES-101
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_title VARCHAR(150) NOT NULL,
    session_description TEXT,
    speaker VARCHAR(100),
    venue_id UUID REFERENCES venues(id) ON DELETE RESTRICT,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL CHECK (end_time > start_time),
    allocated_capacity INTEGER NOT NULL CHECK (allocated_capacity > 0),
    booked_seats INTEGER NOT NULL DEFAULT 0 CHECK (booked_seats >= 0 AND booked_seats <= allocated_capacity),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Event Reviews / Approval History (Association to EventApprover)
CREATE TABLE event_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decision VARCHAR(30) NOT NULL CHECK (decision IN ('STARTED_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
    comments TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Registrations Table (Entity 16.4)
CREATE TABLE registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. REG-480001
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    full_name VARCHAR(80) NOT NULL,
    email VARCHAR(120) NOT NULL,
    contact_phone VARCHAR(15) NOT NULL,
    participant_type VARCHAR(20) NOT NULL CHECK (participant_type IN ('STUDENT', 'PARENT')),
    current_institution VARCHAR(120),
    intended_program VARCHAR(100),
    guests INTEGER NOT NULL DEFAULT 0 CHECK (guests >= 0 AND guests <= 2),
    eligibility_confirmed BOOLEAN NOT NULL DEFAULT false,
    terms_accepted BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_VALIDATION' CHECK (status IN (
        'PENDING_VALIDATION', 'REGISTERED', 'CORRECTION_REQUIRED', 'CANCELLED'
    )),
    cancel_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    registration_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- BR-006: A participant cannot register twice for the same event
    CONSTRAINT uq_active_event_participant UNIQUE (event_id, participant_id)
);

-- 8. Attendance Table (Entity 16.5)
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. ATT-700001
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRESENT', 'ABSENT')),
    recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    attendance_date_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Post-Event Feedback Table (Entity 16.7 - UC-014)
CREATE TABLE feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id VARCHAR(20) UNIQUE NOT NULL, -- e.g. FDB-1001
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_event_feedback_participant UNIQUE (event_id, participant_id)
);

-- 10. Audit Logs Table (NFR-007 / NFR-020)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(60) NOT NULL,
    target VARCHAR(100),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high-concurrency lookups
CREATE INDEX idx_events_status_date ON events(status, event_date);
CREATE INDEX idx_sessions_event_id ON sessions(event_id);
CREATE INDEX idx_registrations_participant ON registrations(participant_id);
CREATE INDEX idx_attendance_session ON attendance(session_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
