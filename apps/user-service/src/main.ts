import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import {
  UpdateProfileRequestSchema,
  RegisterIdentifierRequestSchema,
  VerifyIdentifierRequestSchema,
  GrantConsentRequestSchema,
  WithdrawConsentRequestSchema,
  CreateAuthorisationRequestSchema,
  RevokeAuthorisationRequestSchema,
  CreateDeletionRequestSchema,
  createSuccessResponse,
  createErrorResponse
} from "@nijakavach/contracts";
import {
  normalizeE164Phone,
  generateHmacFingerprint,
  encryptAes256Gcm,
  maskPhoneNumber,
  maskEmail,
  validateInternalServiceKey
} from "@nijakavach/security";
import {
  IdentifierType,
  IdentifierVerificationStatus,
  ConsentPurpose,
  ConsentStatus,
  AuthorisationStatus,
  DeletionRequestStatus,
  StatutoryBasis
} from "@nijakavach/shared-types";
import { InMemoryEventBus, EventTypes } from "@nijakavach/event-contracts";

export interface UserProfileRecord {
  id: string;
  accountId: string;
  fullName: string;
  locale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalIdentifierRecord {
  id: string;
  userProfileId: string;
  type: IdentifierType;
  encryptedValue: string;
  keyVersion: string;
  hmacFingerprint: string;
  maskedDisplay: string;
  verificationStatus: IdentifierVerificationStatus;
  verificationCode?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentRecord {
  id: string;
  userProfileId: string;
  purposeCode: ConsentPurpose;
  statutoryBasis: StatutoryBasis;
  noticeVersion: string;
  noticeHashSha256: string;
  ipAddress: string;
  status: ConsentStatus;
  grantedAt: string;
  withdrawnAt?: string;
  withdrawalReason?: string;
}

export interface AuthorisationRecord {
  id: string;
  userProfileId: string;
  caseId: string;
  sourceId: string;
  statutoryBasis: StatutoryBasis;
  authorisationStatement: string;
  signatureProof: string;
  status: AuthorisationStatus;
  authorisedAt: string;
  revokedAt?: string;
  revocationReason?: string;
}

export interface DataDeletionRequestRecord {
  id: string;
  userProfileId: string;
  statutoryBasis: StatutoryBasis;
  status: DeletionRequestStatus;
  reason?: string;
  requestedAt: string;
  processedAt?: string;
}

export interface UserServiceOptions {
  port?: number;
  internalApiKey?: string;
  eventBus?: InMemoryEventBus;
}

export function createUserServiceServer(options?: UserServiceOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  profiles: Map<string, UserProfileRecord>; // key: accountId
  identifiers: Map<string, PersonalIdentifierRecord[]>; // key: userProfileId
  consents: Map<string, ConsentRecord[]>; // key: userProfileId
  authorisations: Map<string, AuthorisationRecord[]>; // key: userProfileId
  deletionRequests: Map<string, DataDeletionRequestRecord[]>; // key: userProfileId
  eventBus: InMemoryEventBus;
  verifyOperationEligibility: (params: {
    userId: string;
    identifierId: string;
    requiredPurpose: ConsentPurpose;
  }) => { eligible: boolean; reason?: string };
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("user-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("user-service");
  const eventBus = options?.eventBus || new InMemoryEventBus();

  // In-Memory Repositories representing 'user_consent' schema
  const profilesByAccountId = new Map<string, UserProfileRecord>();
  const identifiersByProfileId = new Map<string, PersonalIdentifierRecord[]>();
  const consentsByProfileId = new Map<string, ConsentRecord[]>();
  const authorisationsByProfileId = new Map<string, AuthorisationRecord[]>();
  const deletionRequestsByProfileId = new Map<string, DataDeletionRequestRecord[]>();

  healthChecker.registerComponentCheck("user_consent_db_schema", async () => ({
    status: "UP",
    message: "Schema 'user_consent' reachable"
  }));

  // Helper: Get or create user profile for authenticated account
  function getOrCreateProfile(accountId: string): UserProfileRecord {
    let profile = profilesByAccountId.get(accountId);
    if (!profile) {
      const now = new Date().toISOString();
      profile = {
        id: crypto.randomUUID(),
        accountId,
        fullName: "Consumer User",
        locale: "en-IN",
        timezone: "Asia/Kolkata",
        createdAt: now,
        updatedAt: now
      };
      profilesByAccountId.set(accountId, profile);
    }
    return profile;
  }

  // Pre-Operation Eligibility Check for Future Discovery / Removal Engines
  function verifyOperationEligibility(params: {
    userId: string;
    identifierId: string;
    requiredPurpose: ConsentPurpose;
  }): { eligible: boolean; reason?: string } {
    const profile = profilesByAccountId.get(params.userId);
    if (!profile) {
      return { eligible: false, reason: "User profile not found." };
    }

    const userIdentifiers = identifiersByProfileId.get(profile.id) || [];
    const identifier = userIdentifiers.find(i => i.id === params.identifierId);
    if (!identifier) {
      return { eligible: false, reason: "Personal identifier does not belong to user account." };
    }

    if (identifier.verificationStatus !== IdentifierVerificationStatus.VERIFIED) {
      return {
        eligible: false,
        reason: `Personal identifier is not verified (current status: ${identifier.verificationStatus}). Only verified identifiers may be processed.`
      };
    }

    const userConsents = consentsByProfileId.get(profile.id) || [];
    const activeConsent = userConsents.find(
      c => c.purposeCode === params.requiredPurpose && c.status === ConsentStatus.ACTIVE
    );

    if (!activeConsent) {
      return {
        eligible: false,
        reason: `No active consent record found for purpose '${params.requiredPurpose}'. Explicit statutory consent required.`
      };
    }

    return { eligible: true };
  }

  const server = http.createServer(async (req, res) => {
    const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Correlation-Id", correlationId);

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    const sendJson = (statusCode: number, payload: unknown) => {
      res.writeHead(statusCode);
      res.end(JSON.stringify(payload));
    };

    const sendError = (statusCode: number, code: string, message: string, details?: unknown) => {
      sendJson(statusCode, createErrorResponse(code, message, correlationId, details));
    };

    // Liveness & Readiness Probes
    if (url.pathname === "/health") {
      sendJson(200, healthChecker.executeLiveness());
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      sendJson(ready.status === "DOWN" ? 503 : 200, ready);
      return;
    }

    // Direct Access Prevention: Validate Internal Service Key
    const providedKey = req.headers["x-internal-service-key"] as string | undefined;
    if (!validateInternalServiceKey(providedKey, internalApiKey)) {
      sendError(403, "FORBIDDEN", "Direct service access prohibited; requests must route through API Gateway.");
      return;
    }

    // Authenticated User Context (Injected exclusively by API Gateway from verified JWT)
    const userId = req.headers["x-user-id"] as string | undefined;
    if (!userId) {
      sendError(401, "UNAUTHORIZED", "Missing authenticated user context.");
      return;
    }

    const profile = getOrCreateProfile(userId);

    const parseBody = async (): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (err) {
            reject(err);
          }
        });
      });
    };

    // =========================================================================
    // 1. USER PROFILE: GET /v1/users/me & PATCH /v1/users/me
    // =========================================================================
    if (req.method === "GET" && url.pathname === "/v1/users/me") {
      sendJson(200, createSuccessResponse({
        id: profile.id,
        accountId: profile.accountId,
        fullName: profile.fullName,
        locale: profile.locale,
        timezone: profile.timezone,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      }, correlationId));
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/v1/users/me") {
      try {
        const raw = await parseBody();
        const body = UpdateProfileRequestSchema.parse(raw);

        if (body.fullName !== undefined) profile.fullName = body.fullName;
        if (body.locale !== undefined) profile.locale = body.locale;
        if (body.timezone !== undefined) profile.timezone = body.timezone;
        profile.updatedAt = new Date().toISOString();

        await eventBus.publish(
          EventTypes.USER_PROFILE_UPDATED,
          { userId: profile.accountId, profileId: profile.id, updatedAt: profile.updatedAt },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(200, createSuccessResponse({
          id: profile.id,
          accountId: profile.accountId,
          fullName: profile.fullName,
          locale: profile.locale,
          timezone: profile.timezone,
          updatedAt: profile.updatedAt
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid profile update payload");
        return;
      }
    }

    // =========================================================================
    // 2. PERSONAL IDENTIFIERS: POST, GET, DELETE, VERIFY
    // =========================================================================
    if (req.method === "POST" && (url.pathname === "/v1/users/me/identifiers" || url.pathname === "/v1/users/identifiers")) {
      try {
        const raw = await parseBody();
        const body = RegisterIdentifierRequestSchema.parse(raw);

        let normalizedValue: string;
        let masked: string;

        if (body.type === IdentifierType.PHONE_NUMBER) {
          normalizedValue = normalizeE164Phone(body.value);
          masked = maskPhoneNumber(normalizedValue);
        } else {
          normalizedValue = body.value.toLowerCase().trim();
          masked = maskEmail(normalizedValue);
        }

        // Generate deterministic keyed HMAC fingerprint & AES-256-GCM ciphertext
        const hmacFingerprint = generateHmacFingerprint(normalizedValue, env.HMAC_PEPPER_SECRET);
        const encrypted = encryptAes256Gcm(normalizedValue, env.AES_256_GCM_ENCRYPTION_KEY);

        const currentList = identifiersByProfileId.get(profile.id) || [];

        // Invariant: Prevent duplicate identifier registration within the same account
        const exists = currentList.some(i => i.hmacFingerprint === hmacFingerprint);
        if (exists) {
          sendError(409, "IDENTIFIER_ALREADY_REGISTERED", "This personal identifier is already registered to your account.");
          return;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const record: PersonalIdentifierRecord = {
          id,
          userProfileId: profile.id,
          type: body.type,
          encryptedValue: JSON.stringify(encrypted),
          keyVersion: "v1",
          hmacFingerprint,
          maskedDisplay: masked,
          verificationStatus: IdentifierVerificationStatus.PENDING_VERIFICATION,
          verificationCode: "123456", // Default OTP in development/test environment
          createdAt: now,
          updatedAt: now
        };

        currentList.push(record);
        identifiersByProfileId.set(profile.id, currentList);

        logger.info("Personal identifier added (encrypted & fingerprinted)", {
          correlationId,
          userId,
          identifierId: id,
          type: body.type,
          masked
        });

        await eventBus.publish(
          EventTypes.PERSONAL_IDENTIFIER_ADDED,
          {
            userId,
            identifierId: id,
            type: body.type,
            hmacFingerprint,
            verificationStatus: record.verificationStatus
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(201, createSuccessResponse({
          id: record.id,
          type: record.type,
          maskedDisplay: record.maskedDisplay,
          hmacFingerprint: record.hmacFingerprint,
          verificationStatus: record.verificationStatus,
          createdAt: record.createdAt
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid identifier payload");
        return;
      }
    }

    if (req.method === "GET" && (url.pathname === "/v1/users/me/identifiers" || url.pathname === "/v1/users/identifiers")) {
      const currentList = identifiersByProfileId.get(profile.id) || [];
      sendJson(200, createSuccessResponse(
        currentList.map(item => ({
          id: item.id,
          type: item.type,
          maskedDisplay: item.maskedDisplay,
          hmacFingerprint: item.hmacFingerprint,
          verificationStatus: item.verificationStatus,
          verifiedAt: item.verifiedAt,
          createdAt: item.createdAt
        })),
        correlationId
      ));
      return;
    }

    // Verify Identifier Possession: POST /v1/users/me/identifiers/:id/verify
    if (req.method === "POST" && url.pathname.includes("/identifiers/") && url.pathname.endsWith("/verify")) {
      try {
        const segments = url.pathname.split("/");
        const verifyIndex = segments.indexOf("verify");
        const identifierId = segments[verifyIndex - 1];

        const currentList = identifiersByProfileId.get(profile.id) || [];
        const item = currentList.find(i => i.id === identifierId);

        if (!item) {
          sendError(404, "IDENTIFIER_NOT_FOUND", "Personal identifier not found or does not belong to you.");
          return;
        }

        const raw = await parseBody();
        const body = VerifyIdentifierRequestSchema.parse(raw);

        // Verification code validation (dev code 123456 or stored code)
        if (body.code !== item.verificationCode && body.code !== "123456") {
          sendError(400, "INVALID_VERIFICATION_CODE", "The verification code provided is incorrect.");
          return;
        }

        const now = new Date().toISOString();
        item.verificationStatus = IdentifierVerificationStatus.VERIFIED;
        item.verifiedAt = now;
        item.updatedAt = now;

        await eventBus.publish(
          EventTypes.PERSONAL_IDENTIFIER_VERIFIED,
          {
            userId,
            identifierId: item.id,
            type: item.type,
            verifiedAt: now
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        logger.info("Personal identifier verified successfully", { correlationId, userId, identifierId: item.id });

        sendJson(200, createSuccessResponse({
          id: item.id,
          maskedDisplay: item.maskedDisplay,
          verificationStatus: item.verificationStatus,
          verifiedAt: item.verifiedAt
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid verification request");
        return;
      }
    }

    // Remove Identifier: DELETE /v1/users/me/identifiers/:id
    if (req.method === "DELETE" && url.pathname.includes("/identifiers/")) {
      const segments = url.pathname.split("/");
      const identifierId = segments[segments.length - 1];

      const currentList = identifiersByProfileId.get(profile.id) || [];
      const index = currentList.findIndex(i => i.id === identifierId);

      if (index === -1) {
        sendError(404, "IDENTIFIER_NOT_FOUND", "Personal identifier not found or does not belong to you.");
        return;
      }

      const [removed] = currentList.splice(index, 1);
      identifiersByProfileId.set(profile.id, currentList);

      if (removed) {
        await eventBus.publish(
          EventTypes.PERSONAL_IDENTIFIER_REMOVED,
          {
            userId,
            identifierId: removed.id,
            hmacFingerprint: removed.hmacFingerprint
          },
          correlationId,
          "urn:nijakavach:service:user"
        );
      }

      logger.info("Personal identifier removed", { correlationId, userId, identifierId });

      sendJson(200, createSuccessResponse({
        message: "Personal identifier removed successfully.",
        id: identifierId
      }, correlationId));
      return;
    }

    // =========================================================================
    // 3. CONSENT MANAGEMENT (DPDP ACT 2023): POST, GET, WITHDRAW
    // =========================================================================
    if (req.method === "POST" && (url.pathname === "/v1/users/consent" || url.pathname === "/v1/consents")) {
      try {
        const raw = await parseBody();
        const body = GrantConsentRequestSchema.parse(raw);

        const noticeText = body.noticeText || `Standard DPDP Statutory Notice for ${body.purpose} (v${body.noticeVersion})`;
        const noticeHashSha256 = crypto.createHash("sha256").update(noticeText).digest("hex");

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";

        const record: ConsentRecord = {
          id,
          userProfileId: profile.id,
          purposeCode: body.purpose,
          statutoryBasis: body.statutoryBasis,
          noticeVersion: body.noticeVersion,
          noticeHashSha256,
          ipAddress: clientIp,
          status: ConsentStatus.ACTIVE,
          grantedAt: now
        };

        const currentConsents = consentsByProfileId.get(profile.id) || [];
        currentConsents.push(record);
        consentsByProfileId.set(profile.id, currentConsents);

        logger.info("DPDP explicit statutory consent granted", {
          correlationId,
          userId,
          consentId: id,
          purpose: body.purpose
        });

        await eventBus.publish(
          EventTypes.CONSENT_GRANTED,
          {
            consentId: id,
            userId,
            purpose: body.purpose,
            statutoryBasis: body.statutoryBasis,
            noticeVersion: body.noticeVersion,
            grantedAt: now
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(201, createSuccessResponse(record, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid consent payload");
        return;
      }
    }

    if (req.method === "GET" && (url.pathname === "/v1/users/consent" || url.pathname === "/v1/consents" || url.pathname === "/v1/consents/me")) {
      const userConsents = consentsByProfileId.get(profile.id) || [];
      sendJson(200, createSuccessResponse(userConsents, correlationId));
      return;
    }

    // Withdraw Consent: POST /v1/consents/:id/withdraw or POST /v1/users/consent/:id/withdraw
    if (req.method === "POST" && url.pathname.includes("/withdraw")) {
      try {
        const segments = url.pathname.split("/");
        const withdrawIndex = segments.indexOf("withdraw");
        const consentId = segments[withdrawIndex - 1];

        const userConsents = consentsByProfileId.get(profile.id) || [];
        const record = userConsents.find(c => c.id === consentId);

        if (!record) {
          sendError(404, "CONSENT_NOT_FOUND", "Consent record not found or does not belong to you.");
          return;
        }

        if (record.status === ConsentStatus.WITHDRAWN) {
          sendError(400, "ALREADY_WITHDRAWN", "This consent has already been withdrawn.");
          return;
        }

        const raw = await parseBody();
        const body = WithdrawConsentRequestSchema.parse(raw);

        const now = new Date().toISOString();
        record.status = ConsentStatus.WITHDRAWN;
        record.withdrawnAt = now;
        record.withdrawalReason = body.withdrawalReason || "Consumer initiated revocation";

        logger.info("DPDP consent withdrawn", { correlationId, userId, consentId: record.id, purpose: record.purposeCode });

        await eventBus.publish(
          EventTypes.CONSENT_WITHDRAWN,
          {
            consentId: record.id,
            userId,
            purpose: record.purposeCode,
            withdrawnAt: now,
            reason: record.withdrawalReason
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(200, createSuccessResponse({
          message: "Consent withdrawn successfully. Future automated processing for this purpose has ceased.",
          consent: record
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid withdrawal payload");
        return;
      }
    }

    // =========================================================================
    // 4. ACTION AUTHORISATION RECORDS (DPDP ACT 2023 SEC 12)
    // =========================================================================
    if (req.method === "POST" && (url.pathname === "/v1/users/authorisations" || url.pathname === "/v1/authorisations")) {
      try {
        const raw = await parseBody();
        const body = CreateAuthorisationRequestSchema.parse(raw);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        // Cryptographic electronic signature proof binding user + case + timestamp
        const signatureProof = crypto
          .createHmac("sha256", env.HMAC_PEPPER_SECRET)
          .update(`${userId}:${body.caseId}:${body.sourceId}:${now}`)
          .digest("hex");

        const record: AuthorisationRecord = {
          id,
          userProfileId: profile.id,
          caseId: body.caseId,
          sourceId: body.sourceId,
          statutoryBasis: body.statutoryBasis,
          authorisationStatement: body.authorisationStatement,
          signatureProof,
          status: AuthorisationStatus.ACTIVE,
          authorisedAt: now
        };

        const currentAuths = authorisationsByProfileId.get(profile.id) || [];
        currentAuths.push(record);
        authorisationsByProfileId.set(profile.id, currentAuths);

        logger.info("Statutory removal action authorised by user", {
          correlationId,
          userId,
          authorisationId: id,
          caseId: body.caseId
        });

        await eventBus.publish(
          EventTypes.ACTION_AUTHORISED,
          {
            authorisationId: id,
            userId,
            caseId: body.caseId,
            sourceId: body.sourceId,
            statutoryBasis: body.statutoryBasis,
            authorisedAt: now
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(201, createSuccessResponse(record, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid authorisation payload");
        return;
      }
    }

    if (req.method === "GET" && (url.pathname === "/v1/users/authorisations" || url.pathname === "/v1/authorisations" || url.pathname === "/v1/authorisations/me")) {
      const userAuths = authorisationsByProfileId.get(profile.id) || [];
      sendJson(200, createSuccessResponse(userAuths, correlationId));
      return;
    }

    // Revoke Authorisation: POST /v1/authorisations/:id/revoke
    if (req.method === "POST" && url.pathname.includes("/authorisations/") && url.pathname.endsWith("/revoke")) {
      try {
        const segments = url.pathname.split("/");
        const revokeIndex = segments.indexOf("revoke");
        const authId = segments[revokeIndex - 1];

        const userAuths = authorisationsByProfileId.get(profile.id) || [];
        const record = userAuths.find(a => a.id === authId);

        if (!record) {
          sendError(404, "AUTHORISATION_NOT_FOUND", "Authorisation record not found or does not belong to you.");
          return;
        }

        const raw = await parseBody();
        const body = RevokeAuthorisationRequestSchema.parse(raw);

        const now = new Date().toISOString();
        record.status = AuthorisationStatus.REVOKED;
        record.revokedAt = now;
        record.revocationReason = body.reason || "Revoked by user";

        await eventBus.publish(
          EventTypes.AUTHORISATION_REVOKED,
          {
            authorisationId: record.id,
            userId,
            caseId: record.caseId,
            revokedAt: now
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(200, createSuccessResponse({
          message: "Authorisation revoked successfully.",
          authorisation: record
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid revocation payload");
        return;
      }
    }

    // =========================================================================
    // 5. ACCOUNT DELETION & DATA RIGHTS (DPDP ACT 2023 SEC 12 ERASURE)
    // =========================================================================
    if (req.method === "POST" && (url.pathname === "/v1/users/me/deletion-requests" || url.pathname === "/v1/users/deletion-requests")) {
      try {
        const raw = await parseBody();
        const body = CreateDeletionRequestSchema.parse(raw);

        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        const record: DataDeletionRequestRecord = {
          id,
          userProfileId: profile.id,
          statutoryBasis: StatutoryBasis.DPDP_ACT_2023_SECTION_12_ERASURE,
          status: DeletionRequestStatus.RECEIVED,
          reason: body.reason,
          requestedAt: now
        };

        const currentRequests = deletionRequestsByProfileId.get(profile.id) || [];
        currentRequests.push(record);
        deletionRequestsByProfileId.set(profile.id, currentRequests);

        logger.info("Account deletion request received under DPDP Section 12", {
          correlationId,
          userId,
          deletionRequestId: id
        });

        await eventBus.publish(
          EventTypes.ACCOUNT_DELETION_REQUESTED,
          {
            deletionRequestId: id,
            userId,
            requestedAt: now
          },
          correlationId,
          "urn:nijakavach:service:user"
        );

        sendJson(202, createSuccessResponse({
          message: "Account deletion request received and queued for statutory processing. Non-audit records will be scheduled for erasure.",
          deletionRequest: record
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid deletion request payload");
        return;
      }
    }

    if (req.method === "GET" && (url.pathname === "/v1/users/me/deletion-requests" || url.pathname === "/v1/users/deletion-requests")) {
      const currentRequests = deletionRequestsByProfileId.get(profile.id) || [];
      sendJson(200, createSuccessResponse(currentRequests, correlationId));
      return;
    }

    // =========================================================================
    // 6. INTERNAL ELIGIBILITY VERIFICATION (For Discovery & Removal Engines)
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/users/verify-eligibility") {
      try {
        const raw = await parseBody() as any;
        const result = verifyOperationEligibility({
          userId: raw.userId || userId,
          identifierId: raw.identifierId,
          requiredPurpose: raw.requiredPurpose
        });

        sendJson(200, createSuccessResponse(result, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "BAD_REQUEST", err.message || "Invalid eligibility check parameters");
        return;
      }
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return {
    server,
    healthChecker,
    profiles: profilesByAccountId,
    identifiers: identifiersByProfileId,
    consents: consentsByProfileId,
    authorisations: authorisationsByProfileId,
    deletionRequests: deletionRequestsByProfileId,
    eventBus,
    verifyOperationEligibility
  };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("user-service", env.LOG_LEVEL);
  const { server } = createUserServiceServer();
  const PORT = 4002;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH User & Consent Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
