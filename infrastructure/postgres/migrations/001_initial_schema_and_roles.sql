-- ==============================================================================
-- NIJAKAVACH Migration 001: Logical Schemas & Least-Privilege Roles
-- ==============================================================================

-- 1. Create Logical Schemas
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS user_consent;
CREATE SCHEMA IF NOT EXISTS sources;
CREATE SCHEMA IF NOT EXISTS discovery;
CREATE SCHEMA IF NOT EXISTS cases;
CREATE SCHEMA IF NOT EXISTS removals;
CREATE SCHEMA IF NOT EXISTS verification;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS audit;

-- 2. Create Service Roles with Dedicated Passwords
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'identity_svc_role') THEN
    CREATE ROLE identity_svc_role WITH LOGIN PASSWORD 'identity_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'user_svc_role') THEN
    CREATE ROLE user_svc_role WITH LOGIN PASSWORD 'user_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sources_svc_role') THEN
    CREATE ROLE sources_svc_role WITH LOGIN PASSWORD 'sources_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'discovery_svc_role') THEN
    CREATE ROLE discovery_svc_role WITH LOGIN PASSWORD 'discovery_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'cases_svc_role') THEN
    CREATE ROLE cases_svc_role WITH LOGIN PASSWORD 'cases_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'removals_svc_role') THEN
    CREATE ROLE removals_svc_role WITH LOGIN PASSWORD 'removals_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'verification_svc_role') THEN
    CREATE ROLE verification_svc_role WITH LOGIN PASSWORD 'verification_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'notifications_svc_role') THEN
    CREATE ROLE notifications_svc_role WITH LOGIN PASSWORD 'notifications_dev_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'audit_svc_role') THEN
    CREATE ROLE audit_svc_role WITH LOGIN PASSWORD 'audit_dev_pwd';
  END IF;
END
$$;

-- 3. Grant Least-Privilege Permissions (Strict Boundary Isolation)
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
GRANT ALL ON SCHEMA identity TO identity_svc_role;
GRANT ALL ON SCHEMA identity TO postgres;

REVOKE ALL ON SCHEMA user_consent FROM PUBLIC;
GRANT ALL ON SCHEMA user_consent TO user_svc_role;
GRANT ALL ON SCHEMA user_consent TO postgres;

REVOKE ALL ON SCHEMA sources FROM PUBLIC;
GRANT ALL ON SCHEMA sources TO sources_svc_role;
GRANT ALL ON SCHEMA sources TO postgres;

REVOKE ALL ON SCHEMA discovery FROM PUBLIC;
GRANT ALL ON SCHEMA discovery TO discovery_svc_role;
GRANT ALL ON SCHEMA discovery TO postgres;

REVOKE ALL ON SCHEMA cases FROM PUBLIC;
GRANT ALL ON SCHEMA cases TO cases_svc_role;
GRANT ALL ON SCHEMA cases TO postgres;

REVOKE ALL ON SCHEMA removals FROM PUBLIC;
GRANT ALL ON SCHEMA removals TO removals_svc_role;
GRANT ALL ON SCHEMA removals TO postgres;

REVOKE ALL ON SCHEMA verification FROM PUBLIC;
GRANT ALL ON SCHEMA verification TO verification_svc_role;
GRANT ALL ON SCHEMA verification TO postgres;

REVOKE ALL ON SCHEMA notifications FROM PUBLIC;
GRANT ALL ON SCHEMA notifications TO notifications_svc_role;
GRANT ALL ON SCHEMA notifications TO postgres;

REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT ALL ON SCHEMA audit TO audit_svc_role;
GRANT ALL ON SCHEMA audit TO postgres;
