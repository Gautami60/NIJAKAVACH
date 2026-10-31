-- ==============================================================================
-- NIJAKAVACH Database Migration
-- Version: 003_source_registry_capabilities.sql
-- Description: Source Registry Domain Expansion: Capabilities, Evidence, Integrations, Policies & Removal Procedures
-- Service: Source Registry Service (Schema: sources)
-- ==============================================================================

-- 1. Alter sources.sources table with enterprise metadata
ALTER TABLE sources.sources
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(128),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS country VARCHAR(64) NOT NULL DEFAULT 'IN',
    ADD COLUMN IF NOT EXISTS industry VARCHAR(128);

-- Update display_name to default to name where null
UPDATE sources.sources SET display_name = name WHERE display_name IS NULL;

-- Relax / expand category check constraint on sources.sources
ALTER TABLE sources.sources DROP CONSTRAINT IF EXISTS sources_category_check;
ALTER TABLE sources.sources ADD CONSTRAINT sources_category_check CHECK (
    category IN (
        'CALLER_ID',
        'PUBLIC_DIRECTORY',
        'B2B_DIRECTORY',
        'B2B_REGISTRY',
        'PROFESSIONAL_DIRECTORY',
        'RECRUITMENT_PLATFORM',
        'PEOPLE_SEARCH',
        'LEAD_AGGREGATOR',
        'FINANCIAL_LEAD_GEN',
        'SOCIAL_PLATFORM',
        'OTHER'
    )
);

-- Relax / expand operational_status check constraint on sources.sources
ALTER TABLE sources.sources DROP CONSTRAINT IF EXISTS sources_operational_status_check;
ALTER TABLE sources.sources ADD CONSTRAINT sources_operational_status_check CHECK (
    operational_status IN (
        'ACTIVE',
        'OPERATIONAL',
        'DEGRADED',
        'UNAVAILABLE',
        'DISCONTINUED',
        'RETIRED'
    )
);

-- 2. Alter sources.source_capabilities to support lifecycle & verification tracking
ALTER TABLE sources.source_capabilities
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS review_notes TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Expand capability_type constraint to include canonical DISCOVERY, REMOVAL, VERIFICATION, MONITORING
ALTER TABLE sources.source_capabilities DROP CONSTRAINT IF EXISTS source_capabilities_capability_type_check;
ALTER TABLE sources.source_capabilities ADD CONSTRAINT source_capabilities_capability_type_check CHECK (
    capability_type IN (
        'DISCOVERY',
        'REMOVAL',
        'VERIFICATION',
        'MONITORING',
        'SEARCHABLE',
        'AUTOMATED_API_REMOVAL',
        'WEBFORM_OPT_OUT',
        'EMAIL_NOTICE_REMOVAL'
    )
);

ALTER TABLE sources.source_capabilities DROP CONSTRAINT IF EXISTS source_capabilities_status_check;
ALTER TABLE sources.source_capabilities ADD CONSTRAINT source_capabilities_status_check CHECK (
    status IN (
        'PLANNED',
        'UNDER_REVIEW',
        'VERIFIED_AVAILABLE',
        'IMPLEMENTED',
        'OPERATIONAL',
        'DEGRADED',
        'SUSPENDED',
        'UNAVAILABLE',
        'RETIRED'
    )
);

ALTER TABLE sources.source_capabilities DROP CONSTRAINT IF EXISTS source_capabilities_verification_status_check;
ALTER TABLE sources.source_capabilities ADD CONSTRAINT source_capabilities_verification_status_check CHECK (
    verification_status IN (
        'UNVERIFIED',
        'VERIFIED',
        'EXPIRED',
        'DISPUTED',
        'REJECTED'
    )
);

-- 3. Source Evidence Table
CREATE TABLE IF NOT EXISTS sources.source_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    capability_type VARCHAR(64),
    evidence_type VARCHAR(64) NOT NULL CHECK (
        evidence_type IN (
            'API_DOCUMENTATION',
            'REMOVAL_INSTRUCTIONS',
            'PRIVACY_POLICY',
            'TERMS_OF_SERVICE',
            'SUPPORT_DOCS',
            'MANUAL_TEST_RECORD',
            'PARTNER_DOCUMENTATION'
        )
    ),
    reference_url VARCHAR(512) NOT NULL,
    document_title VARCHAR(255) NOT NULL,
    observation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewer_id VARCHAR(64) NOT NULL,
    verification_status VARCHAR(32) NOT NULL DEFAULT 'UNVERIFIED' CHECK (
        verification_status IN (
            'UNVERIFIED',
            'VERIFIED',
            'EXPIRED',
            'DISPUTED',
            'REJECTED'
        )
    ),
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_evidence_source ON sources.source_evidence(source_id);
CREATE INDEX IF NOT EXISTS idx_sources_evidence_status ON sources.source_evidence(verification_status);

-- 4. Source Integrations Table
CREATE TABLE IF NOT EXISTS sources.source_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    integration_type VARCHAR(64) NOT NULL CHECK (
        integration_type IN (
            'DISCOVERY',
            'REMOVAL_NOTICE',
            'VERIFICATION_CHECK',
            'MONITOR_PROBE'
        )
    ),
    access_method VARCHAR(64) NOT NULL CHECK (
        access_method IN (
            'OFFICIAL_API',
            'OFFICIAL_PARTNER_INTEGRATION',
            'DOCUMENTED_MANUAL_WORKFLOW',
            'USER_ASSISTED_WORKFLOW',
            'GRIEVANCE_OFFICER_NOTICE'
        )
    ),
    integration_status VARCHAR(32) NOT NULL DEFAULT 'PLANNED' CHECK (
        integration_status IN (
            'PLANNED',
            'DEVELOPMENT',
            'TESTING',
            'ACTIVE',
            'DEGRADED',
            'DISABLED'
        )
    ),
    integration_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    operational_notes TEXT,
    last_successful_execution TIMESTAMPTZ,
    last_failed_execution TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_integrations_source ON sources.source_integrations(source_id);

-- 5. Source Policies Table
CREATE TABLE IF NOT EXISTS sources.source_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    terms_url VARCHAR(512),
    privacy_policy_url VARCHAR(512),
    access_restrictions TEXT,
    permitted_methods VARCHAR(64)[],
    rate_limit_info TEXT,
    personal_data_restrictions TEXT,
    removal_procedure_restrictions TEXT,
    policy_review_date TIMESTAMPTZ,
    review_status VARCHAR(32) NOT NULL DEFAULT 'UNDER_REVIEW' CHECK (
        review_status IN (
            'COMPLIANT',
            'UNDER_REVIEW',
            'RESTRICTED',
            'PROHIBITED'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_policies_source ON sources.source_policies(source_id);

-- 6. Source Removal Procedures Table
CREATE TABLE IF NOT EXISTS sources.source_removal_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources.sources(id) ON DELETE CASCADE,
    submission_method VARCHAR(64) NOT NULL CHECK (
        submission_method IN (
            'WEB_FORM',
            'EMAIL_NOTICE',
            'PORTAL_REQUEST',
            'OFFICIAL_API',
            'POSTAL_NOTICE'
        )
    ),
    official_request_url VARCHAR(512),
    compliance_email VARCHAR(255),
    required_evidence TEXT,
    required_user_authorization TEXT,
    supported_request_types VARCHAR(64)[],
    expected_documentation TEXT,
    is_automated BOOLEAN NOT NULL DEFAULT FALSE,
    procedure_verification_status VARCHAR(32) NOT NULL DEFAULT 'UNVERIFIED' CHECK (
        procedure_verification_status IN (
            'UNVERIFIED',
            'VERIFIED',
            'EXPIRED',
            'DISPUTED',
            'REJECTED'
        )
    ),
    last_reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_removal_proc_source ON sources.source_removal_procedures(source_id);

-- 7. Grant schema permissions to sources service database role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sources TO sources_svc_role;

