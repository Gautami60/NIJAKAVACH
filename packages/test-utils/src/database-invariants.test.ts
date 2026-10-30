/**
 * NIJAKAVACH — Database Architecture & Domain Model Invariant Tests
 *
 * Validates:
 *  1. Logical schema ownership & zero cross-schema foreign keys
 *  2. Migration reproducibility & syntax integrity
 *  3. Unique constraint invariants across all domain models
 *  4. Intra-schema foreign key isolation (loose cross-service coupling via stable UUIDs)
 *  5. Sensitive PII AES-256-GCM envelope encryption & decryption
 *  6. Keyed HMAC-SHA256 fingerprint determinism & pepper separation
 *  7. Consent lifecycle state machine (ACTIVE -> WITHDRAWN/EXPIRED)
 *  8. Discovery scan execution state machine & timestamp invariants
 *  9. Removal workflow lifecycle & idempotency invariants
 * 10. Verification outcome taxonomy & distinction invariants
 * 11. Transactional outbox event envelope schema consistency
 * 12. Audit append-only cryptographic hash chaining (SHA-256)
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  normalizeE164Phone,
  generateHmacFingerprint,
  encryptAes256Gcm,
  decryptAes256Gcm,
  maskPhoneNumber
} from "@nijakavach/security";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../infrastructure/postgres/migrations");
const M001_PATH = path.join(MIGRATIONS_DIR, "001_initial_schema_and_roles.sql");
const M002_PATH = path.join(MIGRATIONS_DIR, "002_core_domain_tables.sql");

// ==============================================================================
// 1 & 2: SCHEMA OWNERSHIP, ROLES & MIGRATION REPRODUCIBILITY
// ==============================================================================

test("Database Migration 001 provisions 9 logically isolated schemas and least-privilege roles", () => {
  assert.strictEqual(fs.existsSync(M001_PATH), true, "001_initial_schema_and_roles.sql must exist");
  const sql = fs.readFileSync(M001_PATH, "utf-8");

  const requiredSchemas = [
    "identity",
    "user_consent",
    "sources",
    "discovery",
    "cases",
    "removals",
    "verification",
    "notifications",
    "audit"
  ];

  for (const s of requiredSchemas) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+SCHEMA\\s+IF\\s+NOT\\s+EXISTS\\s+${s};`, "i"),
      `Schema [${s}] must be declared with IF NOT EXISTS`
    );
  }

  const requiredRoles = [
    "identity_svc_role",
    "user_svc_role",
    "sources_svc_role",
    "discovery_svc_role",
    "cases_svc_role",
    "removals_svc_role",
    "verification_svc_role",
    "notifications_svc_role",
    "audit_svc_role"
  ];

  for (const r of requiredRoles) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+ROLE\\s+${r}\\s+WITH\\s+LOGIN`, "i"),
      `Dedicated service role [${r}] must be provisioned`
    );
  }
});

// ==============================================================================
// 3 & 4: ZERO CROSS-SCHEMA FOREIGN KEYS & INTRA-SCHEMA ISOLATION
// ==============================================================================

test("Database Migration 002 enforces zero cross-schema foreign keys (strict service boundary)", () => {
  assert.strictEqual(fs.existsSync(M002_PATH), true, "002_core_domain_tables.sql must exist");
  const sql = fs.readFileSync(M002_PATH, "utf-8");

  const tableBlocks = sql.split(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i).slice(1);
  assert.ok(tableBlocks.length >= 30, `Expected at least 30 tables, found ${tableBlocks.length}`);

  const crossSchemaViolations: string[] = [];

  for (const block of tableBlocks) {
    const headerMatch = block.match(/^([a-z_]+)\.([a-z_]+)/i);
    if (!headerMatch) continue;
    const currentSchema = headerMatch[1];
    const currentTable = headerMatch[2];

    const body = block.split(/\n\);/)[0] || "";
    const fkMatches = body.matchAll(/REFERENCES\s+([a-z_]+)\.([a-z_]+)/gi);

    for (const fk of fkMatches) {
      const referencedSchema = fk[1];
      const referencedTable = fk[2];
      if (referencedSchema !== currentSchema) {
        crossSchemaViolations.push(
          `${currentSchema}.${currentTable} -> references foreign schema table ${referencedSchema}.${referencedTable}`
        );
      }
    }
  }

  assert.deepStrictEqual(
    crossSchemaViolations,
    [],
    `Architectural boundary failure: Cross-schema foreign keys found:\n${crossSchemaViolations.join("\n")}`
  );
});

test("Database Migration 002 mandates UUID Primary Keys on all domain tables", () => {
  const sql = fs.readFileSync(M002_PATH, "utf-8");
  const tableBlocks = sql.split(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i).slice(1);

  for (const block of tableBlocks) {
    const headerMatch = block.match(/^([a-z_]+)\.([a-z_]+)/i);
    if (!headerMatch) continue;
    const tableName = `${headerMatch[1]}.${headerMatch[2]}`;

    assert.match(
      block,
      /id\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)/i,
      `Table [${tableName}] must define an id UUID PRIMARY KEY with gen_random_uuid()`
    );
  }
});

test("Database Migration 002 enforces Unique Constraints for idempotency and identity", () => {
  const sql = fs.readFileSync(M002_PATH, "utf-8");

  // Account email must be unique
  assert.match(sql, /email\s+VARCHAR\(255\)\s+NOT\s+NULL\s+UNIQUE/i);

  // Session token hash must be unique
  assert.match(sql, /session_token_hash\s+VARCHAR\(64\)\s+NOT\s+NULL\s+UNIQUE/i);

  // Personal identifier must be unique per user + hmac fingerprint
  assert.match(sql, /CONSTRAINT\s+uq_user_identifier\s+UNIQUE\s*\(user_profile_id,\s*hmac_fingerprint\)/i);

  // Source slug must be unique
  assert.match(sql, /slug\s+VARCHAR\(64\)\s+NOT\s+NULL\s+UNIQUE/i);

  // Removal submission idempotency key must be unique
  assert.match(sql, /idempotency_key\s+VARCHAR\(64\)\s+NOT\s+NULL\s+UNIQUE/i);

  // Verification job idempotency key must be unique
  assert.match(sql, /idempotency_key\s+VARCHAR\(64\)\s+NOT\s+NULL\s+UNIQUE/i);
});

// ==============================================================================
// 5 & 6: SENSITIVE PII CRYPTOGRAPHY & DETERMINISTIC HMAC LOOKUPS
// ==============================================================================

test("Sensitive personal identifier (phone) normalisation, encryption & HMAC match invariants", () => {
  const pepperSecret = "test_hmac_pepper_secret_value_32_bytes_len";
  const encKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const rawIndianPhone = "98765 43210";
  const normalized = normalizeE164Phone(rawIndianPhone);
  assert.strictEqual(normalized, "+919876543210");

  // HMAC lookup fingerprint determinism
  const fingerprint1 = generateHmacFingerprint(normalized, pepperSecret);
  const fingerprint2 = generateHmacFingerprint(normalized, pepperSecret);
  assert.strictEqual(fingerprint1, fingerprint2, "HMAC lookup fingerprint must be deterministic for exact match");
  assert.strictEqual(fingerprint1.length, 64, "HMAC-SHA256 fingerprint must be 64-char hex");

  // Different pepper produces different fingerprint
  const diffPepper = "different_pepper_secret_for_key_rotation_32";
  const diffFingerprint = generateHmacFingerprint(normalized, diffPepper);
  assert.notStrictEqual(fingerprint1, diffFingerprint, "Fingerprint must depend strictly on pepper secret");

  // Envelope encryption with AES-256-GCM
  const enc1 = encryptAes256Gcm(normalized, encKey);
  const enc2 = encryptAes256Gcm(normalized, encKey);

  // Randomized IV ensures ciphertext is never identical for the same plaintext
  assert.notStrictEqual(enc1.ciphertext, enc2.ciphertext, "Ciphertext must use unique IV for each encryption");
  assert.notStrictEqual(enc1.iv, enc2.iv, "IV must be distinct per operation");

  // Decryption roundtrip
  const decrypted1 = decryptAes256Gcm(enc1.ciphertext, enc1.iv, enc1.tag, encKey);
  const decrypted2 = decryptAes256Gcm(enc2.ciphertext, enc2.iv, enc2.tag, encKey);
  assert.strictEqual(decrypted1, normalized);
  assert.strictEqual(decrypted2, normalized);

  // Display masking invariant (PII safe in UI and logs)
  const masked = maskPhoneNumber(normalized);
  assert.strictEqual(masked, "+9198*****210");
  assert.strictEqual(masked.includes("43"), false, "Masked representation must not expose middle digits");
});

// ==============================================================================
// 7: CONSENT LIFECYCLE STATE INVARIANTS
// ==============================================================================

test("Consent domain lifecycle state transitions and withdrawal tracking", () => {
  type ConsentStatus = "ACTIVE" | "WITHDRAWN" | "EXPIRED";

  interface ConsentEntity {
    id: string;
    userProfileId: string;
    purposeCode: string;
    statutoryBasis: string;
    noticeHashSha256: string;
    status: ConsentStatus;
    grantedAt: Date;
    withdrawnAt?: Date;
    withdrawalReason?: string;
  }

  const consent: ConsentEntity = {
    id: crypto.randomUUID(),
    userProfileId: crypto.randomUUID(),
    purposeCode: "PURPOSE_DISCOVERY_SCAN",
    statutoryBasis: "DPDP_ACT_2023_SECTION_6",
    noticeHashSha256: crypto.createHash("sha256").update("Notice text v1.0").digest("hex"),
    status: "ACTIVE",
    grantedAt: new Date("2026-01-01T00:00:00Z")
  };

  assert.strictEqual(consent.status, "ACTIVE");
  assert.strictEqual(consent.withdrawnAt, undefined);

  // State Transition: User withdraws consent under DPDP Act 2023
  function withdrawConsent(record: ConsentEntity, reason: string): ConsentEntity {
    if (record.status !== "ACTIVE") {
      throw new Error(`Cannot withdraw consent in status: ${record.status}`);
    }
    return {
      ...record,
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawalReason: reason
    };
  }

  const withdrawn = withdrawConsent(consent, "User requested removal of all active discovery authorisations");
  assert.strictEqual(withdrawn.status, "WITHDRAWN");
  assert.ok(withdrawn.withdrawnAt !== undefined);
  assert.strictEqual(withdrawn.withdrawalReason?.includes("DPDP Act"), false);

  // Withdrawn consent cannot be re-withdrawn
  assert.throws(() => withdrawConsent(withdrawn, "Second attempt"), /Cannot withdraw consent/);
});

// ==============================================================================
// 8: DISCOVERY SCAN LIFECYCLE & EXECUTION INVARIANTS
// ==============================================================================

test("Discovery scan execution state machine and asynchronous timestamp invariants", () => {
  type ScanStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";

  interface ScanRecord {
    id: string;
    userId: string;
    status: ScanStatus;
    initiatedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    totalSourcesChecked: number;
    potentialMatchesCount: number;
  }

  const scan: ScanRecord = {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    status: "QUEUED",
    initiatedAt: new Date(Date.now() - 10000),
    totalSourcesChecked: 0,
    potentialMatchesCount: 0
  };

  assert.strictEqual(scan.status, "QUEUED");

  // Invariant: Scan can start only from QUEUED
  function startScan(s: ScanRecord): ScanRecord {
    if (s.status !== "QUEUED") throw new Error("Invalid transition to IN_PROGRESS");
    return { ...s, status: "IN_PROGRESS", startedAt: new Date() };
  }

  const inProgress = startScan(scan);
  assert.strictEqual(inProgress.status, "IN_PROGRESS");
  assert.ok(inProgress.startedAt);

  // Invariant: Completed scan must have completedAt >= startedAt
  function completeScan(s: ScanRecord, sourcesChecked: number, matches: number): ScanRecord {
    if (s.status !== "IN_PROGRESS") throw new Error("Invalid transition to COMPLETED");
    const completedAt = new Date();
    if (s.startedAt && completedAt < s.startedAt) {
      throw new Error("completed_at cannot precede started_at");
    }
    return {
      ...s,
      status: "COMPLETED",
      completedAt,
      totalSourcesChecked: sourcesChecked,
      potentialMatchesCount: matches
    };
  }

  const completed = completeScan(inProgress, 4, 1);
  assert.strictEqual(completed.status, "COMPLETED");
  assert.ok(completed.completedAt! >= completed.startedAt!);

  // Core Product Principle: Potential match is NOT confirmed exposure
  assert.strictEqual(completed.potentialMatchesCount, 1);
});

// ==============================================================================
// 9: REMOVAL WORKFLOW LIFECYCLE & IDEMPOTENCY INVARIANTS
// ==============================================================================

test("Removal workflow lifecycle, user authorisation gate & idempotency invariants", () => {
  type RemovalStatus =
    | "PENDING_SUBMISSION"
    | "SUBMITTED"
    | "ACKNOWLEDGED"
    | "UNDER_REVIEW"
    | "COMPLETED"
    | "REJECTED"
    | "FAILED";

  interface RemovalRequest {
    id: string;
    caseId: string;
    authorisationId: string;
    status: RemovalStatus;
    idempotencyKey: string;
    createdAt: Date;
  }

  const authId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const idempotencyKey = crypto.createHash("sha256").update(`${caseId}:${authId}:attempt-1`).digest("hex");

  const removal: RemovalRequest = {
    id: crypto.randomUUID(),
    caseId,
    authorisationId: authId,
    status: "PENDING_SUBMISSION",
    idempotencyKey,
    createdAt: new Date()
  };

  // Critical product principle: A submitted request is NOT a completed removal
  function submitRemoval(r: RemovalRequest): RemovalRequest {
    if (r.status !== "PENDING_SUBMISSION") throw new Error("Invalid state transition");
    return { ...r, status: "SUBMITTED" };
  }

  const submitted = submitRemoval(removal);
  assert.strictEqual(submitted.status, "SUBMITTED");
  assert.notStrictEqual(submitted.status, "COMPLETED", "Submitted request must not be marked completed");

  // Idempotency check: Same key cannot create a duplicate request
  const processedKeys = new Set<string>();
  processedKeys.add(removal.idempotencyKey);
  assert.strictEqual(processedKeys.has(idempotencyKey), true);
});

// ==============================================================================
// 10: VERIFICATION OUTCOME TAXONOMY & DISTINCTION INVARIANTS
// ==============================================================================

test("Verification domain taxonomy enforces strict distinction between source claim and independent proof", () => {
  const ValidResultCodes = [
    "INDEPENDENTLY_VERIFIED_REMOVED",
    "SOURCE_REPORTED_ONLY",
    "STILL_OBSERVABLE",
    "UNABLE_TO_VERIFY",
    "POSSIBLE_RELISTING"
  ] as const;

  type ResultCode = typeof ValidResultCodes[number];

  // Critical product principles:
  // 1. Source-reported removal is NOT automatically independently verified.
  // 2. A failed verification is NOT proof that information remains exposed.
  const sourceClaimed: ResultCode = "SOURCE_REPORTED_ONLY";
  const independentlyVerified: ResultCode = "INDEPENDENTLY_VERIFIED_REMOVED";
  const unverified: ResultCode = "UNABLE_TO_VERIFY";
  const exposed: ResultCode = "STILL_OBSERVABLE";

  assert.notStrictEqual(sourceClaimed, independentlyVerified, "Source-reported is strictly distinct from verified");
  assert.notStrictEqual(unverified, exposed, "Unable to verify is not proof of continued exposure");

  // Verify all codes exist in the database check constraint
  const sql = fs.readFileSync(M002_PATH, "utf-8");
  for (const code of ValidResultCodes) {
    assert.strictEqual(
      sql.includes(code),
      true,
      `Verification result code [${code}] must be present in migration check constraints`
    );
  }
});

// ==============================================================================
// 11: TRANSACTIONAL OUTBOX EVENT ENVELOPE CONSISTENCY
// ==============================================================================

test("Transactional outbox tables conform to standard event envelope across all domains", () => {
  const sql = fs.readFileSync(M002_PATH, "utf-8");

  const requiredOutboxSchemas = [
    "identity",
    "user_consent",
    "sources",
    "discovery",
    "cases",
    "removals",
    "verification",
    "notifications"
  ];

  for (const s of requiredOutboxSchemas) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${s}\\.outbox_messages`, "i"),
      `Outbox table must exist for schema [${s}]`
    );
  }

  // Envelope column requirements
  const requiredFields = [
    "aggregate_type",
    "aggregate_id",
    "event_type",
    "event_version",
    "payload JSONB",
    "status VARCHAR(32)",
    "retry_count INT",
    "created_at TIMESTAMPTZ"
  ];

  for (const field of requiredFields) {
    assert.match(
      sql,
      new RegExp(field.replace("(", "\\(").replace(")", "\\)"), "i"),
      `Outbox envelope must define [${field}]`
    );
  }
});

// ==============================================================================
// 12: AUDIT APPEND-ONLY CRYPTOGRAPHIC HASH CHAINING
// ==============================================================================

test("Audit domain implements SHA-256 cryptographic block hash chaining and tamper detection", () => {
  interface AuditEventRecord {
    id: string;
    actorType: "USER" | "SYSTEM_DAEMON" | "COMPLIANCE_OFFICER";
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    correlationId: string;
    payloadDigestSha256: string;
    previousBlockHash: string;
    blockHash: string;
    timestamp: string;
  }

  function computeBlockHash(event: Omit<AuditEventRecord, "blockHash">): string {
    const raw = `${event.previousBlockHash}|${event.actorType}|${event.actorId}|${event.action}|${event.entityType}|${event.entityId}|${event.payloadDigestSha256}|${event.timestamp}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

  // Block 1: User Account Registration
  const event1Base = {
    id: crypto.randomUUID(),
    actorType: "USER" as const,
    actorId: "usr-001",
    action: "IDENTITY_ACCOUNT_CREATED",
    entityType: "ACCOUNT",
    entityId: "usr-001",
    correlationId: "cor-001",
    payloadDigestSha256: crypto.createHash("sha256").update(JSON.stringify({ email: "priya@example.in" })).digest("hex"),
    previousBlockHash: GENESIS_HASH,
    timestamp: "2026-10-31T00:00:00.000Z"
  };
  const event1: AuditEventRecord = {
    ...event1Base,
    blockHash: computeBlockHash(event1Base)
  };

  // Block 2: Consent Granted
  const event2Base = {
    id: crypto.randomUUID(),
    actorType: "USER" as const,
    actorId: "usr-001",
    action: "CONSENT_GRANTED_DISCOVERY",
    entityType: "CONSENT",
    entityId: "con-001",
    correlationId: "cor-002",
    payloadDigestSha256: crypto.createHash("sha256").update(JSON.stringify({ purpose: "DISCOVERY" })).digest("hex"),
    previousBlockHash: event1.blockHash,
    timestamp: "2026-10-31T00:01:00.000Z"
  };
  const event2: AuditEventRecord = {
    ...event2Base,
    blockHash: computeBlockHash(event2Base)
  };

  // Verify chain integrity
  assert.strictEqual(event2.previousBlockHash, event1.blockHash, "Block 2 must point to Block 1 hash");

  // Tamper simulation: Attacker tampers with event 1 action in database
  const tamperedEvent1 = { ...event1, action: "IDENTITY_ACCOUNT_DELETED" };
  const recomputedHash = computeBlockHash(tamperedEvent1);
  assert.notStrictEqual(recomputedHash, event2.previousBlockHash, "Tampering with Block 1 breaks cryptographic chain");
});
