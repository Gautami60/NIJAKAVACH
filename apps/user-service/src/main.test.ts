import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import { createUserServiceServer } from "./main";
import {
  IdentifierType,
  IdentifierVerificationStatus,
  ConsentPurpose,
  ConsentStatus,
  AuthorisationStatus,
  DeletionRequestStatus
} from "@nijakavach/shared-types";

describe("User, Identifier & Consent Service Tests", () => {
  let server: http.Server;
  let serverPort: number;
  let verifyOperationEligibility: any;

  const internalApiKey = "test-internal-service-key-1234567890!";
  const testUserId1 = "user-uuid-1111-1111-1111";
  const testUserId2 = "user-uuid-2222-2222-2222";

  const headersUser1 = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey,
    "x-user-id": testUserId1
  };

  const headersUser2 = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey,
    "x-user-id": testUserId2
  };

  before(async () => {
    const instance = createUserServiceServer({
      internalApiKey
    });
    server = instance.server;
    verifyOperationEligibility = instance.verifyOperationEligibility;

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // 1. USER PROFILE & OWNERSHIP
  // =========================================================================
  test("1. Profile retrieval retrieves profile strictly for authenticated user", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me`, {
      method: "GET",
      headers: headersUser1
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.accountId, testUserId1);
    assert.strictEqual(body.data.locale, "en-IN");
  });

  test("2. Profile update modifies permitted attributes and preserves ownership", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me`, {
      method: "PATCH",
      headers: headersUser1,
      body: JSON.stringify({
        fullName: "Priya Sharma",
        locale: "hi-IN"
      })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.data.fullName, "Priya Sharma");
    assert.strictEqual(body.data.locale, "hi-IN");

    // Verify User 2 sees their own default profile and cannot see or overwrite User 1
    const res2 = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me`, {
      method: "GET",
      headers: headersUser2
    });
    const body2 = await res2.json() as any;
    assert.strictEqual(body2.data.accountId, testUserId2);
    assert.notStrictEqual(body2.data.fullName, "Priya Sharma");
  });

  // =========================================================================
  // 2. PERSONAL IDENTIFIERS: NORMALIZATION, ENCRYPTION, FINGERPRINTING, VERIFICATION
  // =========================================================================
  let createdIdentifierId: string;

  test("3. Register phone number normalizes to E.164, computes HMAC, encrypts, and masks", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/identifiers`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({
        type: IdentifierType.PHONE_NUMBER,
        value: "098765 43210" // leading trunk zero and spaces
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.id);
    createdIdentifierId = body.data.id;

    // Must be masked
    assert.strictEqual(body.data.maskedDisplay, "+9198*****210");
    assert.ok(body.data.hmacFingerprint);
    assert.strictEqual(body.data.verificationStatus, IdentifierVerificationStatus.PENDING_VERIFICATION);
    assert.strictEqual((body.data as any).encryptedValue, undefined, "Encrypted payload must not leak in ordinary responses");
    assert.strictEqual((body.data as any).rawValue, undefined, "Raw phone number must never be returned");
  });

  test("4. Duplicate identifier registration within same account returns 409", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/identifiers`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({
        type: IdentifierType.PHONE_NUMBER,
        value: "+91 9876543210" // Equivalent phone in different formatting
      })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "IDENTIFIER_ALREADY_REGISTERED");
  });

  test("5. Unverified identifier restriction blocks operational eligibility", () => {
    const eligibility = verifyOperationEligibility({
      userId: testUserId1,
      identifierId: createdIdentifierId,
      requiredPurpose: ConsentPurpose.DISCOVERY_SCAN
    });

    assert.strictEqual(eligibility.eligible, false);
    assert.match(eligibility.reason || "", /not verified/i);
  });

  test("6. Identifier verification with valid OTP updates status to VERIFIED", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/identifiers/${createdIdentifierId}/verify`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({ code: "123456" })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.data.verificationStatus, IdentifierVerificationStatus.VERIFIED);
    assert.ok(body.data.verifiedAt);
  });

  test("7. Cross-user identifier access prevention rejects operations on another user's identifier", async () => {
    // User 2 attempts to delete User 1's identifier
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/identifiers/${createdIdentifierId}`, {
      method: "DELETE",
      headers: headersUser2
    });

    assert.strictEqual(res.status, 404);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "IDENTIFIER_NOT_FOUND");
  });

  // =========================================================================
  // 3. CONSENT MANAGEMENT (DPDP ACT 2023 SEC 6)
  // =========================================================================
  let createdConsentId: string;

  test("8. Grant explicit purpose-specific statutory consent captures cryptographic notice hash", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/consents`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({
        purpose: ConsentPurpose.DISCOVERY_SCAN,
        noticeVersion: "2026.1",
        noticeText: "I authorise NIJAKAVACH to query supported public directories to discover potential exposure of my phone number."
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.id);
    createdConsentId = body.data.id;
    assert.strictEqual(body.data.purposeCode, ConsentPurpose.DISCOVERY_SCAN);
    assert.strictEqual(body.data.status, ConsentStatus.ACTIVE);
    assert.ok(body.data.noticeHashSha256);
  });

  test("9. Operational eligibility succeeds once identifier is verified and purpose consent is active", () => {
    const eligibility = verifyOperationEligibility({
      userId: testUserId1,
      identifierId: createdIdentifierId,
      requiredPurpose: ConsentPurpose.DISCOVERY_SCAN
    });

    assert.strictEqual(eligibility.eligible, true);
  });

  test("10. Unbundled consent: Discovery consent does NOT confer removal consent", () => {
    const eligibility = verifyOperationEligibility({
      userId: testUserId1,
      identifierId: createdIdentifierId,
      requiredPurpose: ConsentPurpose.REMOVAL_SUBMISSION
    });

    assert.strictEqual(eligibility.eligible, false);
    assert.match(eligibility.reason || "", /No active consent record found/i);
  });

  test("11. Consent withdrawal revokes permission while preserving historical audit record", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/consents/${createdConsentId}/withdraw`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({ withdrawalReason: "No longer wish to be monitored" })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.data.consent.status, ConsentStatus.WITHDRAWN);
    assert.ok(body.data.consent.withdrawnAt);
    assert.strictEqual(body.data.consent.withdrawalReason, "No longer wish to be monitored");

    // Immediate operational effect: discovery is now blocked
    const eligibilityAfter = verifyOperationEligibility({
      userId: testUserId1,
      identifierId: createdIdentifierId,
      requiredPurpose: ConsentPurpose.DISCOVERY_SCAN
    });
    assert.strictEqual(eligibilityAfter.eligible, false);

    // List consents still preserves the record for legal audit
    const listRes = await fetch(`http://127.0.0.1:${serverPort}/v1/consents`, {
      method: "GET",
      headers: headersUser1
    });
    const listBody = await listRes.json() as any;
    const item = listBody.data.find((c: any) => c.id === createdConsentId);
    assert.ok(item, "Historical consent record must be preserved");
    assert.strictEqual(item.status, ConsentStatus.WITHDRAWN);
  });

  // =========================================================================
  // 4. ACTION AUTHORISATION (DPDP ACT 2023 SEC 12)
  // =========================================================================
  let createdAuthId: string;

  test("12. Action authorisation captures specific case approval with HMAC signature proof", async () => {
    const caseId = "c1111111-1111-4111-a111-111111111111";
    const sourceId = "b2222222-2222-4222-b222-222222222222";

    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/authorisations`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({
        caseId,
        sourceId,
        authorisationStatement: "I hereby authorise NIJAKAVACH to submit a statutory removal notice under Section 12 of the DPDP Act 2023 to National Directory Beta."
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    createdAuthId = body.data.id;
    assert.strictEqual(body.data.caseId, caseId);
    assert.strictEqual(body.data.status, AuthorisationStatus.ACTIVE);
    assert.ok(body.data.signatureProof);
  });

  test("13. Authorisation can be revoked explicitly by user", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/authorisations/${createdAuthId}/revoke`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({ reason: "Decided to contact provider directly" })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.data.authorisation.status, AuthorisationStatus.REVOKED);
    assert.ok(body.data.authorisation.revokedAt);
  });

  // =========================================================================
  // 5. ACCOUNT DELETION & DATA RIGHTS (DPDP SEC 12 ERASURE)
  // =========================================================================
  test("14. Account deletion request queues request without purging immutable audit logs", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/deletion-requests`, {
      method: "POST",
      headers: headersUser1,
      body: JSON.stringify({
        passwordConfirmation: "SuperSecretPassword123!",
        reason: "Exercising DPDP Act Section 12 Right to Erasure"
      })
    });

    assert.strictEqual(res.status, 202);
    const body = await res.json() as any;
    assert.strictEqual(body.data.deletionRequest.status, DeletionRequestStatus.RECEIVED);
    assert.ok(body.data.deletionRequest.requestedAt);

    // Verify status via GET
    const listRes = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me/deletion-requests`, {
      method: "GET",
      headers: headersUser1
    });
    const listBody = await listRes.json() as any;
    assert.strictEqual(listBody.data.length, 1);
    assert.strictEqual(listBody.data[0].status, DeletionRequestStatus.RECEIVED);
  });

  // =========================================================================
  // 6. PERIMETER CONTROLS
  // =========================================================================
  test("15. Direct call without internal key returns 403 Forbidden", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me`, {
      method: "GET",
      headers: { "x-user-id": testUserId1 } // Missing x-internal-service-key
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "FORBIDDEN");
  });

  test("16. Request without authenticated user context returns 401 Unauthorized", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/users/me`, {
      method: "GET",
      headers: { "x-internal-service-key": internalApiKey } // Missing x-user-id
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "UNAUTHORIZED");
  });
});
