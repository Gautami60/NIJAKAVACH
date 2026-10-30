-- ==============================================================================
-- NIJAKAVACH Migration 002: Core Domain Models & Schemas
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. IDENTITY DOMAIN (Schema: identity)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS identity.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'DELETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_accounts_status ON identity.accounts(status);

CREATE TABLE IF NOT EXISTS identity.credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    password_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_credentials_account ON identity.credentials(account_id);

CREATE TABLE IF NOT EXISTS identity.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_sessions_lookup ON identity.sessions(session_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_identity_sessions_account ON identity.sessions(account_id);

CREATE TABLE IF NOT EXISTS identity.email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES identity.accounts(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL CHECK (event_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'PASSWORD_RESET', 'ACCOUNT_LOCKED', 'SESSION_REVOKED')),
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_security_account_time ON identity.security_events(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS identity.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_identity_outbox_pending ON identity.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 2. USER & CONSENT DOMAIN (Schema: user_consent)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_consent.user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL UNIQUE, -- Stable conceptual reference to identity.accounts
    full_name VARCHAR(128) NOT NULL,
    locale VARCHAR(10) NOT NULL DEFAULT 'en-IN',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_consent.personal_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_profile_id UUID NOT NULL REFERENCES user_consent.user_profiles(id) ON DELETE CASCADE,
    identifier_type VARCHAR(32) NOT NULL CHECK (identifier_type IN ('PHONE_NUMBER', 'EMAIL_ADDRESS')),
    encrypted_value TEXT NOT NULL, -- AES-256-GCM ciphertext + IV + auth tag
    key_version VARCHAR(16) NOT NULL DEFAULT 'v1', -- Envelope encryption key version for rotation
    hmac_fingerprint VARCHAR(64) NOT NULL, -- Keyed HMAC-SHA256 for exact match & index queries
    masked_display VARCHAR(64) NOT NULL, -- e.g. +91 98*****210
    verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (verification_status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REVOKED')),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_identifier UNIQUE (user_profile_id, hmac_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_identifiers_lookup ON user_consent.personal_identifiers(hmac_fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_identifiers_profile ON user_consent.personal_identifiers(user_profile_id);

CREATE TABLE IF NOT EXISTS user_consent.consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_profile_id UUID NOT NULL REFERENCES user_consent.user_profiles(id) ON DELETE CASCADE,
    purpose_code VARCHAR(64) NOT NULL CHECK (purpose_code IN ('PURPOSE_DISCOVERY_SCAN', 'PURPOSE_REMOVAL_SUBMISSION', 'PURPOSE_PERSISTENT_MONITORING')),
    statutory_basis VARCHAR(64) NOT NULL DEFAULT 'DPDP_ACT_2023_SECTION_6',
    notice_version VARCHAR(32) NOT NULL,
    notice_hash_sha256 VARCHAR(64) NOT NULL, -- Cryptographic hash of exact notice wording shown
    ip_address VARCHAR(45),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ,
    withdrawal_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_records_active ON user_consent.consent_records(user_profile_id, purpose_code) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS user_consent.authorisation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_profile_id UUID NOT NULL REFERENCES user_consent.user_profiles(id) ON DELETE CASCADE,
    case_id UUID NOT NULL, -- Conceptual link to cases.exposure_cases
    source_id UUID NOT NULL, -- Conceptual link to sources.sources
    statutory_basis VARCHAR(64) NOT NULL DEFAULT 'DPDP_ACT_2023_SECTION_12',
    authorisation_statement TEXT NOT NULL,
    signature_proof VARCHAR(255) NOT NULL,
    authorised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_authorisation_records_case ON user_consent.authorisation_records(case_id);

CREATE TABLE IF NOT EXISTS user_consent.data_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_profile_id UUID NOT NULL REFERENCES user_consent.user_profiles(id) ON DELETE CASCADE,
    statutory_basis VARCHAR(64) NOT NULL DEFAULT 'DPDP_ACT_2023_SECTION_12_ERASURE',
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSING', 'COMPLETED', 'REJECTED')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_consent.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_outbox_pending ON user_consent.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 3. SOURCE REGISTRY DOMAIN (Schema: sources)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS sources.sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL UNIQUE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    category VARCHAR(64) NOT NULL CHECK (category IN ('PUBLIC_DIRECTORY', 'LEAD_AGGREGATOR', 'B2B_REGISTRY', 'PEOPLE_SEARCH')),
    base_url VARCHAR(512) NOT NULL,
    operational_status VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL' CHECK (operational_status IN ('OPERATIONAL', 'DEGRADED', 'UNAVAILABLE', 'DISCONTINUED')),
    rate_limit_per_minute INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_status ON sources.sources(operational_status);

CREATE TABLE IF NOT EXISTS sources.source_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    capability_type VARCHAR(64) NOT NULL CHECK (capability_type IN ('SEARCHABLE', 'AUTOMATED_API_REMOVAL', 'WEBFORM_OPT_OUT', 'EMAIL_NOTICE_REMOVAL')),
    supported_identifier_types VARCHAR(32)[] NOT NULL,
    access_method VARCHAR(64) NOT NULL CHECK (access_method IN ('PUBLIC_HTML_GET', 'PUBLIC_REST_API', 'WEBFORM_POST', 'GRIEVANCE_EMAIL')),
    applicable_restrictions TEXT,
    compliance_endpoint VARCHAR(512),
    grievance_officer_email VARCHAR(255),
    CONSTRAINT uq_source_capability UNIQUE (source_id, capability_type)
);

CREATE TABLE IF NOT EXISTS sources.source_health_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    latency_ms INT NOT NULL,
    http_status INT NOT NULL,
    health_status VARCHAR(32) NOT NULL CHECK (health_status IN ('OPERATIONAL', 'DEGRADED', 'UNAVAILABLE')),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_health_time ON sources.source_health_records(source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS sources.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sources_outbox_pending ON sources.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 4. DISCOVERY DOMAIN (Schema: discovery)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS discovery.scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    identifier_id UUID NOT NULL,
    identifier_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    total_sources INT NOT NULL DEFAULT 0,
    completed_sources INT NOT NULL DEFAULT 0,
    candidates_found INT NOT NULL DEFAULT 0,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discovery_scans_user ON discovery.scans(user_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_scans_status ON discovery.scans(status);

CREATE TABLE IF NOT EXISTS discovery.source_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES discovery.scans(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RATE_LIMITED')),
    retry_count INT NOT NULL DEFAULT 0,
    failure_reason TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_source_checks_scan ON discovery.source_checks(scan_id);
CREATE INDEX IF NOT EXISTS idx_source_checks_status ON discovery.source_checks(status);

CREATE TABLE IF NOT EXISTS discovery.scan_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_check_id UUID NOT NULL REFERENCES discovery.source_checks(id) ON DELETE CASCADE,
    scan_id UUID NOT NULL REFERENCES discovery.scans(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,
    identifier_fingerprint VARCHAR(64) NOT NULL,
    evidence_s3_key VARCHAR(512) NOT NULL,
    evidence_sha256 VARCHAR(64) NOT NULL,
    observed_url VARCHAR(1024) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_results_lookup ON discovery.scan_results(identifier_fingerprint);

CREATE TABLE IF NOT EXISTS discovery.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discovery_outbox_pending ON discovery.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 5. CASE MANAGEMENT DOMAIN (Schema: cases)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cases.exposure_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_id UUID NOT NULL,
    identifier_fingerprint VARCHAR(64) NOT NULL,
    masked_identifier VARCHAR(64) NOT NULL,
    source_url VARCHAR(1024) NOT NULL,
    state VARCHAR(48) NOT NULL DEFAULT 'POTENTIAL_EXPOSURE_DISCOVERED' CHECK (state IN (
        'POTENTIAL_EXPOSURE_DISCOVERED',
        'MATCH_CONFIRMED',
        'DISMISSED_AS_FALSE_POSITIVE',
        'AWAITING_USER_AUTHORISATION',
        'REQUEST_PREPARED',
        'REQUEST_SUBMITTED',
        'REQUEST_ACKNOWLEDGED',
        'ADDITIONAL_ACTION_REQUIRED',
        'REQUEST_REJECTED',
        'SOURCE_REPORTS_REMOVAL',
        'REMOVAL_INDEPENDENTLY_VERIFIED',
        'UNABLE_TO_VERIFY',
        'INFORMATION_REAPPEARED',
        'CLOSED_RESOLVED',
        'CLOSED_NO_ACTION'
    )),
    first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exposure_cases_user ON cases.exposure_cases(user_id, state);
CREATE INDEX IF NOT EXISTS idx_exposure_cases_fingerprint ON cases.exposure_cases(identifier_fingerprint);

CREATE TABLE IF NOT EXISTS cases.evidence_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases.exposure_cases(id) ON DELETE CASCADE,
    s3_storage_key VARCHAR(512) NOT NULL,
    content_hash_sha256 VARCHAR(64) NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    byte_size INT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_classification VARCHAR(32) NOT NULL DEFAULT 'CONFIDENTIAL_PII' CHECK (access_classification IN ('CONFIDENTIAL_PII', 'INTERNAL_AUDIT', 'PUBLIC_EVIDENCE')),
    retention_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_evidence_case ON cases.evidence_snapshots(case_id);

CREATE TABLE IF NOT EXISTS cases.case_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases.exposure_cases(id) ON DELETE CASCADE,
    from_state VARCHAR(48) NOT NULL,
    to_state VARCHAR(48) NOT NULL,
    reason TEXT,
    actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM_WORKER', 'COMPLIANCE_OPERATOR')),
    actor_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_history_time ON cases.case_status_history(case_id, transitioned_at DESC);

CREATE TABLE IF NOT EXISTS cases.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cases_outbox_pending ON cases.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 6. REMOVAL WORKFLOW DOMAIN (Schema: removals)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS removals.removal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL UNIQUE, -- Stable reference to cases.exposure_cases
    user_id UUID NOT NULL,
    source_id UUID NOT NULL,
    statutory_basis VARCHAR(64) NOT NULL DEFAULT 'DPDP_ACT_2023_SECTION_12',
    state VARCHAR(48) NOT NULL DEFAULT 'REQUEST_PREPARED' CHECK (state IN ('REQUEST_PREPARED', 'SUBMITTED', 'ACKNOWLEDGED', 'ADDITIONAL_ACTION_REQUIRED', 'REJECTED', 'SOURCE_REPORTS_REMOVAL')),
    authorisation_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_removal_requests_user ON removals.removal_requests(user_id, state);

CREATE TABLE IF NOT EXISTS removals.removal_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    removal_request_id UUID NOT NULL REFERENCES removals.removal_requests(id) ON DELETE CASCADE,
    submission_channel VARCHAR(64) NOT NULL CHECK (submission_channel IN ('GRIEVANCE_EMAIL', 'WEBFORM_POST', 'AUTOMATED_API', 'REGISTERED_POST')),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    payload_digest_sha256 VARCHAR(64) NOT NULL,
    attempt_number INT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'DELIVERY_CONFIRMED', 'DELIVERY_FAILED')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_removal_submissions_request ON removals.removal_submissions(removal_request_id);

CREATE TABLE IF NOT EXISTS removals.removal_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    removal_request_id UUID NOT NULL REFERENCES removals.removal_requests(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES removals.removal_submissions(id) ON DELETE CASCADE,
    response_type VARCHAR(48) NOT NULL CHECK (response_type IN ('ACKNOWLEDGEMENT_TICKET', 'REJECTION_FORMAL', 'ACTION_REQUIRED', 'REMOVAL_CLAIMED')),
    source_ticket_reference VARCHAR(128),
    response_summary TEXT NOT NULL,
    evidence_s3_key VARCHAR(512),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_removal_responses_request ON removals.removal_responses(removal_request_id);

CREATE TABLE IF NOT EXISTS removals.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_removals_outbox_pending ON removals.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 7. VERIFICATION DOMAIN (Schema: verification)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS verification.verification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL,
    removal_request_id UUID NOT NULL,
    source_id UUID NOT NULL,
    identifier_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_schedule ON verification.verification_jobs(status, scheduled_for);

CREATE TABLE IF NOT EXISTS verification.verification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES verification.verification_jobs(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evidence_s3_key VARCHAR(512),
    evidence_sha256 VARCHAR(64),
    result VARCHAR(48) NOT NULL CHECK (result IN ('STILL_OBSERVABLE', 'INDEPENDENTLY_VERIFIED_REMOVED', 'SOURCE_REPORTED_ONLY', 'UNABLE_TO_VERIFY', 'POSSIBLE_RELISTING')),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_job ON verification.verification_attempts(job_id);

CREATE TABLE IF NOT EXISTS verification.relisting_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL,
    source_id UUID NOT NULL,
    previous_verified_removal_at TIMESTAMPTZ NOT NULL,
    relisted_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    new_evidence_s3_key VARCHAR(512) NOT NULL,
    alert_dispatched BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_relisting_case ON verification.relisting_records(case_id);

CREATE TABLE IF NOT EXISTS verification.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_verification_outbox_pending ON verification.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 8. NOTIFICATION DOMAIN (Schema: notifications)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS notifications.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    channel VARCHAR(32) NOT NULL CHECK (channel IN ('EMAIL', 'IN_APP', 'SMS')),
    template_code VARCHAR(64) NOT NULL,
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (delivery_status IN ('QUEUED', 'DISPATCHED', 'DELIVERED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    failure_reason TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_user ON notifications.notification_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    scan_complete_alert BOOLEAN NOT NULL DEFAULT TRUE,
    removal_status_alert BOOLEAN NOT NULL DEFAULT TRUE,
    relist_critical_alert BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications.outbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_pending ON notifications.outbox_messages(status, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 9. AUDIT DOMAIN (Schema: audit)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS audit.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM_DAEMON', 'COMPLIANCE_OFFICER')),
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    payload_digest_sha256 VARCHAR(64) NOT NULL,
    outcome VARCHAR(32) NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
    previous_block_hash VARCHAR(64) NOT NULL,
    block_hash VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit.audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit.audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit.audit_events(timestamp DESC);
