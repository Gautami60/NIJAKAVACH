import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import { Pool } from "pg";
import {
  createDatabasePool,
  checkDatabaseHealth,
  withTransaction,
  closeDatabasePool
} from "./db/pool";
import { SourceRegistryMigrator } from "./db/migrator";
import {
  PostgresSourceRepository,
  PostgresSourceCapabilityRepository,
  PostgresSourceEvidenceRepository,
  PostgresSourceRemovalProcedureRepository,
  PostgresSourceHealthRepository,
  PostgresOutboxRepository
} from "./repositories/postgres-repositories";
import {
  SourceCategory,
  SourceCapabilityType,
  SourceCapabilityStatus,
  EvidenceVerificationStatus,
  SourceEvidenceType,
  SourceSubmissionMethod,
  SourceHealthStatus,
  IdentifierType
} from "@nijakavach/shared-types";
import { createOutboxMessage } from "@nijakavach/event-contracts";

describe("Source Registry PostgreSQL Persistence & Integration Tests", () => {
  let pool: Pool | null = null;
  let isPostgresAvailable = false;
  let migrator: SourceRegistryMigrator | null = null;

  before(async () => {
    try {
      pool = createDatabasePool({
        connectionTimeoutMillis: 1500
      });
      const health = await checkDatabaseHealth(pool);
      if (health.isHealthy) {
        isPostgresAvailable = true;
        migrator = new SourceRegistryMigrator(pool);
      } else {
        console.warn("\n================================================================================");
        console.warn("[PERSISTENCE INTEGRATION]: PostgreSQL offline (ECONNREFUSED at 127.0.0.1:5432).");
        console.warn("Real database integration tests will be explicitly marked as skipped / pending infrastructure.");
        console.warn("================================================================================\n");
      }
    } catch {
      isPostgresAvailable = false;
    }
  });

  after(async () => {
    if (pool) {
      await closeDatabasePool(pool);
    }
  });

  // =========================================================================
  // 1. DATABASE CONNECTIVITY & PERMISSIONS
  // =========================================================================

  test("1. PostgreSQL connectivity check and role authentication", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const health = await checkDatabaseHealth(pool);
    assert.strictEqual(health.isHealthy, true);
    assert.ok(health.latencyMs >= 0);
  });

  test("2. Least-privilege role boundaries: sources_svc_role cannot access identity or user_consent schemas", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const client = await pool.connect();
    try {
      // Must be able to access sources schema
      const sourcesRes = await client.query("SELECT 1 FROM sources.sources LIMIT 1;");
      assert.ok(sourcesRes);

      // Must be DENIED access to identity.accounts (permission denied)
      await assert.rejects(
        async () => {
          await client.query("SELECT * FROM identity.accounts;");
        },
        (err: any) => err.code === "42501" || err.message.includes("permission denied")
      );
    } finally {
      client.release();
    }
  });

  // =========================================================================
  // 2. MIGRATIONS & TRACKING TABLE
  // =========================================================================

  test("3. Migrator executes 001, 002, 003 and tracks versions idempotently in sources.schema_migrations", async (t) => {
    if (!isPostgresAvailable || !pool || !migrator) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const firstRun = await migrator.runMigrations();
    assert.ok(firstRun.applied.length >= 0);

    const applied = await migrator.getAppliedMigrations();
    assert.ok(applied.includes("001_initial_schema_and_roles") || applied.includes("003_source_registry_capabilities"));

    // Second run must be idempotent (all skipped)
    const secondRun = await migrator.runMigrations();
    assert.strictEqual(secondRun.applied.length, 0);
    assert.ok(secondRun.skipped.length >= 3);
  });

  // =========================================================================
  // 3. ATOMIC TRANSACTIONS & ROLLBACK
  // =========================================================================

  test("4. Transaction rollback: on error, neither source, audit, nor outbox message persists", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const sourceRepo = new PostgresSourceRepository(pool);
    const outboxRepo = new PostgresOutboxRepository(pool);
    const testId = "s9999999-9999-4999-a999-999999999999";
    const testSlug = "rollback-test-source";

    // Attempt transaction that throws midway
    await assert.rejects(
      async () => {
        await withTransaction(pool!, async (client) => {
          await sourceRepo.create(
            {
              id: testId,
              name: "Rollback Test Name",
              slug: testSlug,
              displayName: "Rollback Test",
              description: null,
              category: SourceCategory.PUBLIC_DIRECTORY,
              baseUrl: "https://rollback.example.com",
              country: "IN",
              industry: null,
              operationalStatus: "ACTIVE",
              rateLimitPerMinute: 30,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            client
          );

          await outboxRepo.create(
            createOutboxMessage("Source", testId, "TEST_EVENT", {}, "corr-rollback"),
            client
          );

          // Force failure before commit
          throw new Error("Simulated failure to verify rollback atomicity");
        });
      },
      /Simulated failure to verify rollback atomicity/
    );

    // Verify rollback: source must NOT exist
    const found = await sourceRepo.findById(testId);
    assert.strictEqual(found, null);

    // Verify outbox message must NOT exist
    const pending = await outboxRepo.findPending(100);
    const outboxFound = pending.find((m) => m.aggregateId === testId);
    assert.strictEqual(outboxFound, undefined);
  });

  // =========================================================================
  // 4. PERSISTENCE & UNIQUE CONSTRAINTS
  // =========================================================================

  test("5. Source persistence, retrieval, and unique slug constraint (PostgreSQL code 23505)", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const sourceRepo = new PostgresSourceRepository(pool);
    const testId = "s8888888-8888-4888-a888-888888888888";
    const testSlug = "karnataka-b2b-registry";

    // Create source
    const created = await sourceRepo.create({
      id: testId,
      name: "Karnataka B2B Commerce Directory",
      slug: testSlug,
      displayName: "Karnataka B2B Registry",
      description: "Official Karnataka commercial merchant directory.",
      category: SourceCategory.B2B_DIRECTORY,
      baseUrl: "https://b2b.karnataka.gov.in",
      country: "IN",
      industry: "B2B Trade",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 45,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(created.id, testId);

    // Retrieve by slug
    const retrieved = await sourceRepo.findBySlug(testSlug);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, "Karnataka B2B Commerce Directory");

    // Duplicate slug insertion must trigger database error 23505 (unique_violation)
    await assert.rejects(
      async () => {
        await sourceRepo.create({
          id: "s8888888-8888-4888-a888-888888888889",
          name: "Different Name Duplicate Slug",
          slug: testSlug,
          displayName: "Duplicate",
          description: null,
          category: SourceCategory.B2B_DIRECTORY,
          baseUrl: "https://dup.example.com",
          country: "IN",
          industry: null,
          operationalStatus: "ACTIVE",
          rateLimitPerMinute: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      },
      (err: any) => err.code === "23505"
    );
  });

  test("6. Capabilities and Evidence persistence with verification gate", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const capRepo = new PostgresSourceCapabilityRepository(pool);
    const evRepo = new PostgresSourceEvidenceRepository(pool);

    const sourceId = "s8888888-8888-4888-a888-888888888888";

    // Add capability
    const cap = await capRepo.create({
      id: "c8888888-8888-4888-b888-888888888881",
      sourceId,
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER],
      accessMethod: "OFFICIAL_API",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(cap.status, SourceCapabilityStatus.PLANNED);

    // Evidence check: must be false before attaching verified evidence
    const hasEvidenceBefore = await evRepo.hasVerifiedEvidence(sourceId, SourceCapabilityType.DISCOVERY);
    assert.strictEqual(hasEvidenceBefore, false);

    // Attach verified evidence
    const ev = await evRepo.create({
      id: "e8888888-8888-4888-c888-888888888881",
      sourceId,
      capabilityType: SourceCapabilityType.DISCOVERY,
      evidenceType: SourceEvidenceType.API_DOCUMENTATION,
      referenceUrl: "https://b2b.karnataka.gov.in/docs",
      documentTitle: "Karnataka B2B API Specs",
      observationDate: new Date().toISOString(),
      reviewerId: "admin-uuid-001",
      verificationStatus: EvidenceVerificationStatus.VERIFIED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(ev.verificationStatus, EvidenceVerificationStatus.VERIFIED);

    const hasEvidenceAfter = await evRepo.hasVerifiedEvidence(sourceId, SourceCapabilityType.DISCOVERY);
    assert.strictEqual(hasEvidenceAfter, true);
  });

  test("7. Health records and removal procedures persistence", async (t) => {
    if (!isPostgresAvailable || !pool) {
      t.skip("Skipped: PostgreSQL 16 server is not running on port 5432 in this environment.");
      return;
    }

    const healthRepo = new PostgresSourceHealthRepository(pool);
    const procRepo = new PostgresSourceRemovalProcedureRepository(pool);
    const sourceId = "s8888888-8888-4888-a888-888888888888";

    // Record health probe
    const h = await healthRepo.create({
      id: "h8888888-8888-4888-d888-888888888881",
      sourceId,
      latencyMs: 120,
      httpStatus: 200,
      healthStatus: SourceHealthStatus.OPERATIONAL,
      checkedAt: new Date().toISOString()
    });

    assert.strictEqual(h.latencyMs, 120);
    const recent = await healthRepo.findBySourceId(sourceId, 5);
    assert.ok(recent.length >= 1);

    // Record removal procedure
    const proc = await procRepo.create({
      id: "p8888888-8888-4888-e888-888888888881",
      sourceId,
      submissionMethod: SourceSubmissionMethod.WEB_FORM,
      officialRequestUrl: "https://b2b.karnataka.gov.in/privacy/opt-out",
      complianceEmail: "grievance@karnataka.gov.in",
      supportedRequestTypes: ["OPTOUT"],
      isAutomated: false,
      procedureVerificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(proc.submissionMethod, SourceSubmissionMethod.WEB_FORM);
    const procs = await procRepo.findBySourceId(sourceId);
    assert.ok(procs.length >= 1);
  });
});
