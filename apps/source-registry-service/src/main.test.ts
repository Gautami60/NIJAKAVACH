import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import { createSourceRegistryServer } from "./main";
import {
  SourceCategory,
  SourceCapabilityType,
  SourceCapabilityStatus,
  EvidenceVerificationStatus,
  SourceEvidenceType,
  SourceAccessMethod,
  SourceSubmissionMethod,
  SourceIntegrationType,
  SourceHealthStatus,
  IdentifierType,
  UserRole
} from "@nijakavach/shared-types";
import { EventTypes } from "@nijakavach/event-contracts";

describe("Source Registry & Capability Management Service Tests", () => {
  let server: http.Server;
  let serverPort: number;
  let outbox: any[];
  let auditLogs: any[];

  const internalApiKey = "test-internal-service-key-xyz999!";
  const adminActorId = "admin-uuid-0001";
  const complianceActorId = "compliance-uuid-0002";
  const consumerActorId = "consumer-uuid-0003";

  const adminHeaders = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey,
    "x-user-id": adminActorId,
    "x-user-roles": UserRole.SYSTEM_ADMIN
  };

  const complianceHeaders = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey,
    "x-user-id": complianceActorId,
    "x-user-roles": UserRole.COMPLIANCE_OFFICER
  };

  const consumerHeaders = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey,
    "x-user-id": consumerActorId,
    "x-user-roles": UserRole.USER
  };

  before(async () => {
    const instance = createSourceRegistryServer({
      internalApiKey
    });
    server = instance.server;
    outbox = instance.outbox;
    auditLogs = instance.auditLogs;

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
  // 1. RESEARCH CANDIDATES & CATALOGUE READS
  // =========================================================================

  test("1. Seed candidates are strictly initialized as research candidates with UNVERIFIED status", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.length >= 5);

    const truecaller = body.data.find((s: any) => s.slug === "truecaller");
    assert.ok(truecaller, "Truecaller research candidate must exist");
    assert.strictEqual(truecaller.category, SourceCategory.CALLER_ID);

    // Capabilities must NOT be operational without verified evidence
    for (const cap of truecaller.capabilities) {
      assert.strictEqual(cap.status, SourceCapabilityStatus.PLANNED);
      assert.strictEqual(cap.verificationStatus, EvidenceVerificationStatus.UNVERIFIED);
    }
  });

  test("2. Public catalogue redacts sensitive operational notes and diagnostics", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/truecaller`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.slug, "truecaller");
    assert.strictEqual(body.data.reviewNotes, undefined);
    assert.strictEqual(body.data.internalNotes, undefined);
  });

  test("3. Source category count summary endpoint operates correctly", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/categories`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.categories[SourceCategory.CALLER_ID] >= 2);
    assert.ok(body.data.categories[SourceCategory.PUBLIC_DIRECTORY] >= 1);
  });

  test("4. Filtering catalogue by category and search keyword functions accurately", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources?category=${SourceCategory.CALLER_ID}&search=Truecaller`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].slug, "truecaller");
  });

  // =========================================================================
  // 2. ADMINISTRATIVE ACCESS CONTROL & RBAC
  // =========================================================================

  test("5. Non-admin / Consumer role cannot create or mutate sources (403 Forbidden)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources`, {
      method: "POST",
      headers: consumerHeaders,
      body: JSON.stringify({
        name: "Malicious Directory",
        slug: "malicious-dir",
        category: SourceCategory.PUBLIC_DIRECTORY,
        baseUrl: "https://malicious.example.com"
      })
    });

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "FORBIDDEN");
  });

  test("6. Administrator can create a new source, emits SOURCE_REGISTERED event and audit log", async () => {
    const initialOutboxCount = outbox.length;
    const initialAuditCount = auditLogs.length;

    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Delhi Trade Registry",
        slug: "delhi-trade-reg",
        displayName: "Delhi Trade & Commerce Registry",
        description: "Official local trade merchant directory for NCR.",
        category: SourceCategory.B2B_DIRECTORY,
        baseUrl: "https://trade.delhi.gov.in",
        country: "IN",
        industry: "Commerce & Trade",
        rateLimitPerMinute: 60
      })
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.slug, "delhi-trade-reg");

    // Verify outbox message
    assert.strictEqual(outbox.length, initialOutboxCount + 1);
    const event = outbox[outbox.length - 1];
    assert.strictEqual(event.eventType, EventTypes.SOURCE_REGISTERED);
    assert.strictEqual(event.payload.slug, "delhi-trade-reg");

    // Verify audit log
    assert.strictEqual(auditLogs.length, initialAuditCount + 1);
    const audit = auditLogs[auditLogs.length - 1];
    assert.strictEqual(audit.action, "CREATE_SOURCE");
    assert.strictEqual(audit.actorId, adminActorId);
  });

  test("7. Duplicate source registration (slug or name) is strictly prevented (409 Conflict)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Different Name",
        slug: "delhi-trade-reg", // Duplicate slug
        category: SourceCategory.B2B_DIRECTORY,
        baseUrl: "https://duplicate.example.com"
      })
    });

    assert.strictEqual(res.status, 409);
    const body = (await res.json()) as any;
    assert.strictEqual(body.error.code, "DUPLICATE_SOURCE_SLUG");
  });

  // =========================================================================
  // 3. CAPABILITIES, EVIDENCE & LIFECYCLE CONSTRAINTS
  // =========================================================================

  test("8. Compliance officer can add capability in PLANNED / UNVERIFIED state", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/capabilities`, {
      method: "POST",
      headers: complianceHeaders,
      body: JSON.stringify({
        capabilityType: SourceCapabilityType.DISCOVERY,
        supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER],
        accessMethod: "OFFICIAL_API",
        complianceEndpoint: "https://trade.delhi.gov.in/privacy",
        grievanceOfficerEmail: "privacy@trade.delhi.gov.in"
      })
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, SourceCapabilityStatus.PLANNED);
    assert.strictEqual(body.data.verificationStatus, EvidenceVerificationStatus.UNVERIFIED);
  });

  test("9. Capability cannot become OPERATIONAL without verified evidence (422 EVIDENCE_REQUIRED)", async () => {
    // Get capability ID
    const getRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/capabilities`);
    const caps = (await getRes.json()) as any;
    const capId = caps.data[0].id;

    // Try promoting to OPERATIONAL without verified evidence
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/capabilities/${capId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: SourceCapabilityStatus.OPERATIONAL
      })
    });

    assert.strictEqual(res.status, 422);
    const body = (await res.json()) as any;
    assert.strictEqual(body.error.code, "EVIDENCE_REQUIRED");
  });

  test("10. Attaching and verifying evidence enables capability transition to OPERATIONAL", async () => {
    // 1. Attach Evidence
    const evRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/evidence`, {
      method: "POST",
      headers: complianceHeaders,
      body: JSON.stringify({
        capabilityType: SourceCapabilityType.DISCOVERY,
        evidenceType: SourceEvidenceType.API_DOCUMENTATION,
        referenceUrl: "https://trade.delhi.gov.in/developer/docs",
        documentTitle: "Delhi Trade Registry Official API Specs v2",
        reviewNotes: "Official developer docs inspected and verified."
      })
    });
    assert.strictEqual(evRes.status, 201);
    const evBody = (await evRes.json()) as any;
    const evidenceId = evBody.data.id;

    // 2. Verify Evidence
    const verifyRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/evidence/${evidenceId}`, {
      method: "PATCH",
      headers: complianceHeaders,
      body: JSON.stringify({
        verificationStatus: EvidenceVerificationStatus.VERIFIED,
        reviewNotes: "Cryptographic signature and API endpoint tested successfully."
      })
    });
    assert.strictEqual(verifyRes.status, 200);

    // 3. Now promote capability to OPERATIONAL
    const getRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/capabilities`);
    const caps = (await getRes.json()) as any;
    const capId = caps.data[0].id;

    const promoteRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/capabilities/${capId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: SourceCapabilityStatus.OPERATIONAL,
        verificationStatus: EvidenceVerificationStatus.VERIFIED
      })
    });

    assert.strictEqual(promoteRes.status, 200);
    const promoteBody = (await promoteRes.json()) as any;
    assert.strictEqual(promoteBody.data.status, SourceCapabilityStatus.OPERATIONAL);
    assert.strictEqual(promoteBody.data.verificationStatus, EvidenceVerificationStatus.VERIFIED);
  });

  test("11. When evidence is marked EXPIRED or DISPUTED, operational capability automatically demotes to UNDER_REVIEW", async () => {
    const getSourceRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg`);
    const sBody = (await getSourceRes.json()) as any;
    const sourceId = sBody.data.id;

    // Create an evidence that gets disputed
    const evRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/${sourceId}/evidence`, {
      method: "POST",
      headers: complianceHeaders,
      body: JSON.stringify({
        capabilityType: SourceCapabilityType.DISCOVERY,
        evidenceType: SourceEvidenceType.TERMS_OF_SERVICE,
        referenceUrl: "https://trade.delhi.gov.in/terms",
        documentTitle: "Delhi Trade Registry Terms 2026"
      })
    });
    const ev = (await evRes.json()) as any;

    // Mark as DISPUTED
    const disputeRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/${sourceId}/evidence/${ev.data.id}`, {
      method: "PATCH",
      headers: complianceHeaders,
      body: JSON.stringify({
        verificationStatus: EvidenceVerificationStatus.DISPUTED,
        reviewNotes: "Source changed terms to prohibit query access."
      })
    });
    assert.strictEqual(disputeRes.status, 200);

    // Verify the capability was demoted from OPERATIONAL to UNDER_REVIEW
    const checkCapRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/${sourceId}/capabilities`);
    const updatedCaps = (await checkCapRes.json()) as any;
    assert.strictEqual(updatedCaps.data[0].status, SourceCapabilityStatus.UNDER_REVIEW);
  });

  // =========================================================================
  // 4. REMOVAL PROCEDURES, INTEGRATIONS & POLICIES
  // =========================================================================

  test("12. Registering removal procedure requires valid URL or compliance email", async () => {
    // Missing both URL and email
    const failRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/removal-procedures`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        submissionMethod: SourceSubmissionMethod.WEB_FORM
      })
    });
    assert.strictEqual(failRes.status, 400);

    // Valid removal procedure
    const successRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/removal-procedures`, {
      method: "POST",
      headers: complianceHeaders,
      body: JSON.stringify({
        submissionMethod: SourceSubmissionMethod.WEB_FORM,
        officialRequestUrl: "https://trade.delhi.gov.in/privacy/opt-out",
        complianceEmail: "grievance@trade.delhi.gov.in",
        requiredUserAuthorization: "Verified statutory phone OTP authorization",
        isAutomated: false
      })
    });
    assert.strictEqual(successRes.status, 201);
    const body = (await successRes.json()) as any;
    assert.strictEqual(body.data.submissionMethod, SourceSubmissionMethod.WEB_FORM);
  });

  test("13. Integration registration supports standard access methods without scraping", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/integrations`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        integrationType: SourceIntegrationType.DISCOVERY,
        accessMethod: SourceAccessMethod.OFFICIAL_API,
        integrationVersion: "2.1.0",
        operationalNotes: "Requires OAuth 2.0 client credentials via trade ministry gateway."
      })
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as any;
    assert.strictEqual(body.data.accessMethod, SourceAccessMethod.OFFICIAL_API);
    assert.strictEqual(body.data.integrationStatus, "PLANNED");
  });

  test("14. Recording health probe updates source status and emits SOURCE_HEALTH_CHANGED", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg/health`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        latencyMs: 1420,
        httpStatus: 503,
        healthStatus: SourceHealthStatus.DEGRADED
      })
    });

    assert.strictEqual(res.status, 201);
    const body = (await res.json()) as any;
    assert.strictEqual(body.data.healthStatus, SourceHealthStatus.DEGRADED);

    // Verify source operationalStatus updated
    const sRes = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg`);
    const sBody = (await sRes.json()) as any;
    assert.strictEqual(sBody.data.operationalStatus, "DEGRADED");
  });

  test("15. Source retirement enqueues SOURCE_RETIRED event", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/sources/delhi-trade-reg`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        operationalStatus: "RETIRED"
      })
    });

    assert.strictEqual(res.status, 200);
    const sBody = (await res.json()) as any;
    assert.strictEqual(sBody.data.operationalStatus, "RETIRED");

    const retiredEvent = outbox.find((e: any) => e.eventType === EventTypes.SOURCE_RETIRED);
    assert.ok(retiredEvent, "SOURCE_RETIRED event must be present in outbox");
  });

  test("16. Internal outbox check enforces internal service key protection", async () => {
    // Call without key
    const unauthRes = await fetch(`http://127.0.0.1:${serverPort}/internal/outbox/pending`);
    assert.strictEqual(unauthRes.status, 403);

    // Call with key
    const authRes = await fetch(`http://127.0.0.1:${serverPort}/internal/outbox/pending`, {
      headers: {
        "x-internal-service-key": internalApiKey
      }
    });
    assert.strictEqual(authRes.status, 200);
    const body = (await authRes.json()) as any;
    assert.ok(body.data.pendingCount >= 1);
  });
});
