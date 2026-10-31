import * as http from "node:http";
import * as crypto from "node:crypto";
import { Pool } from "pg";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import {
  CreateSourceSchema,
  UpdateSourceSchema,
  AddCapabilitySchema,
  UpdateCapabilityStatusSchema,
  AddEvidenceSchema,
  UpdateEvidenceStatusSchema,
  AddPolicySchema,
  AddRemovalProcedureSchema,
  RegisterIntegrationSchema,
  UpdateSourceHealthSchema,
  createSuccessResponse,
  createErrorResponse
} from "@nijakavach/contracts";
import {
  SourceCapabilityStatus,
  EvidenceVerificationStatus,
  SourcePolicyReviewStatus,
  UserRole
} from "@nijakavach/shared-types";
import {
  EventTypes,
  createOutboxMessage
} from "@nijakavach/event-contracts";
import {
  SourceRecord,
  SourceCapabilityRecord,
  SourceEvidenceRecord,
  SourceIntegrationRecord,
  SourcePolicyRecord,
  SourceRemovalProcedureRecord,
  SourceHealthRecord,
  AuditRecord,
  ISourceRepository,
  ISourceCapabilityRepository,
  ISourceEvidenceRepository,
  ISourceIntegrationRepository,
  ISourcePolicyRepository,
  ISourceRemovalProcedureRepository,
  ISourceHealthRepository,
  IOutboxRepository,
  IAuditRepository
} from "./repositories/interfaces";
import {
  PostgresSourceRepository,
  PostgresSourceCapabilityRepository,
  PostgresSourceEvidenceRepository,
  PostgresSourceIntegrationRepository,
  PostgresSourcePolicyRepository,
  PostgresSourceRemovalProcedureRepository,
  PostgresSourceHealthRepository,
  PostgresOutboxRepository,
  PostgresAuditRepository
} from "./repositories/postgres-repositories";
import {
  MemorySourceRepository,
  MemorySourceCapabilityRepository,
  MemorySourceEvidenceRepository,
  MemorySourceIntegrationRepository,
  MemorySourcePolicyRepository,
  MemorySourceRemovalProcedureRepository,
  MemorySourceHealthRepository,
  MemoryOutboxRepository,
  MemoryAuditRepository,
  getInitialSeedData
} from "./repositories/memory-repositories";
import {
  createDatabasePool,
  checkDatabaseHealth,
  withTransaction,
  closeDatabasePool
} from "./db/pool";
import { SourceRegistryMigrator } from "./db/migrator";

export {
  SourceRecord,
  SourceCapabilityRecord,
  SourceEvidenceRecord,
  SourceIntegrationRecord,
  SourcePolicyRecord,
  SourceRemovalProcedureRecord,
  SourceHealthRecord,
  AuditRecord
};

export interface RepositoryBundle {
  sources: ISourceRepository;
  capabilities: ISourceCapabilityRepository;
  evidence: ISourceEvidenceRepository;
  integrations: ISourceIntegrationRepository;
  policies: ISourcePolicyRepository;
  removalProcedures: ISourceRemovalProcedureRepository;
  health: ISourceHealthRepository;
  outbox: IOutboxRepository;
  audit: IAuditRepository;
}

export interface SourceRegistryOptions {
  port?: number;
  internalApiKey?: string;
  jwtSecret?: string;
  dbPool?: Pool;
  usePostgres?: boolean;
  repositories?: RepositoryBundle;
}

function validateInternalServiceKey(providedKey: string | undefined, expectedKey: string): boolean {
  if (!providedKey || !expectedKey) return false;
  if (providedKey.length !== expectedKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
}

// ==============================================================================
// Source Registry Service Engine
// ==============================================================================

export function createSourceRegistryServer(options?: SourceRegistryOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  dbPool?: Pool;
  repos: RepositoryBundle;
  migrator?: SourceRegistryMigrator;
  outbox: any[];
  auditLogs: any[];
  close: () => Promise<void>;
} {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("source-registry-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("source-registry-service");
  const internalApiKey = options?.internalApiKey || process.env.INTERNAL_SERVICE_KEY || "dev-internal-key-999";

  let dbPool: Pool | undefined = options?.dbPool;
  let migrator: SourceRegistryMigrator | undefined;

  // Initialize Repositories (PostgreSQL vs In-Memory Provider)
  let repos: RepositoryBundle;

  if (options?.repositories) {
    repos = options.repositories;
  } else if (options?.usePostgres) {
    if (!dbPool) {
      dbPool = createDatabasePool();
    }
    migrator = new SourceRegistryMigrator(dbPool);
    repos = {
      sources: new PostgresSourceRepository(dbPool),
      capabilities: new PostgresSourceCapabilityRepository(dbPool),
      evidence: new PostgresSourceEvidenceRepository(dbPool),
      integrations: new PostgresSourceIntegrationRepository(dbPool),
      policies: new PostgresSourcePolicyRepository(dbPool),
      removalProcedures: new PostgresSourceRemovalProcedureRepository(dbPool),
      health: new PostgresSourceHealthRepository(dbPool),
      outbox: new PostgresOutboxRepository(dbPool),
      audit: new PostgresAuditRepository(dbPool)
    };
  } else {
    // Default in-memory repositories initialized with research candidates
    const { sources: initialSources, capabilities: initialCaps } = getInitialSeedData();
    repos = {
      sources: new MemorySourceRepository(initialSources),
      capabilities: new MemorySourceCapabilityRepository(initialCaps),
      evidence: new MemorySourceEvidenceRepository(),
      integrations: new MemorySourceIntegrationRepository(),
      policies: new MemorySourcePolicyRepository(),
      removalProcedures: new MemorySourceRemovalProcedureRepository(),
      health: new MemorySourceHealthRepository(),
      outbox: new MemoryOutboxRepository(),
      audit: new MemoryAuditRepository()
    };
  }

  // Register Health Component Checks
  if (dbPool) {
    healthChecker.registerComponentCheck("sources_database_pool", async () => {
      const health = await checkDatabaseHealth(dbPool!);
      return {
        status: health.isHealthy ? "UP" : "DOWN",
        message: health.isHealthy
          ? `PostgreSQL sources pool connected (${health.latencyMs}ms)`
          : `PostgreSQL connection error: ${health.error}`
      };
    });
  } else {
    healthChecker.registerComponentCheck("sources_storage", async () => ({
      status: "UP",
      message: "In-memory repository active (testing / offline mode)"
    }));
  }

  // Redaction Helper: Strips Internal Notes & Diagnostics for Public Consumers
  async function redactSourceForPublic(s: SourceRecord): Promise<Record<string, unknown>> {
    const caps = await repos.capabilities.findBySourceId(s.id);
    const publicCaps = caps.map((c) => ({
      id: c.id,
      capabilityType: c.capabilityType,
      status: c.status,
      verificationStatus: c.verificationStatus,
      supportedIdentifierTypes: c.supportedIdentifierTypes,
      lastReviewedAt: c.lastReviewedAt
    }));

    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      displayName: s.displayName,
      description: s.description,
      category: s.category,
      baseUrl: s.baseUrl,
      country: s.country,
      operationalStatus: s.operationalStatus,
      capabilities: publicCaps,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    };
  }

  const server = http.createServer(async (req, res) => {
    const correlationId: string = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
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

    const parseBody = async (): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 512 * 1024) {
            reject(new Error("Payload too large"));
          }
        });
        req.on("end", () => {
          if (!body) return resolve({});
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid JSON body"));
          }
        });
        req.on("error", reject);
      });
    };

    // Extract User Roles & Identity
    const actorId = (req.headers["x-user-id"] as string) || "anonymous";
    const rawRoles = (req.headers["x-user-roles"] as string) || "";
    const userRoles = rawRoles ? rawRoles.split(",").map((r) => r.trim() as UserRole) : [];

    const isAdmin = userRoles.includes(UserRole.SYSTEM_ADMIN) || userRoles.includes(UserRole.COMPLIANCE_OFFICER);

    // 1. Probes
    if (url.pathname === "/health") {
      sendJson(200, healthChecker.executeLiveness());
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      sendJson(ready.status === "DOWN" ? 503 : 200, ready);
      return;
    }

    // 2. Public / Redacted Catalogue Endpoints

    // GET /v1/sources/categories — List categories with count
    if (req.method === "GET" && url.pathname === "/v1/sources/categories") {
      try {
        const counts = await repos.sources.countByCategory();
        sendJson(200, createSuccessResponse({ categories: counts }, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to count categories");
        return;
      }
    }

    // GET /v1/sources — List sources with search, filters & pagination
    if (req.method === "GET" && url.pathname === "/v1/sources") {
      try {
        const categoryFilter = url.searchParams.get("category") || undefined;
        const capabilityFilter = url.searchParams.get("capability") || undefined;
        const countryFilter = url.searchParams.get("country") || undefined;
        const searchKeyword = url.searchParams.get("search") || undefined;
        const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));

        const { sources, total } = await repos.sources.list({
          category: categoryFilter,
          capability: capabilityFilter,
          country: countryFilter,
          search: searchKeyword,
          page,
          limit
        });

        const redacted = await Promise.all(sources.map(redactSourceForPublic));

        sendJson(
          200,
          createSuccessResponse(redacted, correlationId, {
            timestamp: new Date().toISOString(),
            page,
            limit,
            total
          })
        );
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to list sources");
        return;
      }
    }

    // GET /v1/sources/:id/capabilities — Public capabilities list
    const capsMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/capabilities$/);
    if (req.method === "GET" && capsMatch && capsMatch[1]) {
      const identifier = capsMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }
      const caps = await repos.capabilities.findBySourceId(source.id);
      const publicCaps = caps.map((c) => ({
        id: c.id,
        capabilityType: c.capabilityType,
        status: c.status,
        verificationStatus: c.verificationStatus,
        supportedIdentifierTypes: c.supportedIdentifierTypes,
        lastReviewedAt: c.lastReviewedAt
      }));
      sendJson(200, createSuccessResponse(publicCaps, correlationId));
      return;
    }

    // GET /v1/sources/:id/removal-procedures — Public removal procedures
    const procMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/removal-procedures$/);
    if (req.method === "GET" && procMatch && procMatch[1]) {
      const identifier = procMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }
      const procs = await repos.removalProcedures.findBySourceId(source.id);
      const publicProcs = procs.map((p) => ({
        id: p.id,
        submissionMethod: p.submissionMethod,
        officialRequestUrl: p.officialRequestUrl,
        complianceEmail: p.complianceEmail,
        supportedRequestTypes: p.supportedRequestTypes,
        expectedDocumentation: p.expectedDocumentation,
        isAutomated: p.isAutomated,
        procedureVerificationStatus: p.procedureVerificationStatus
      }));
      sendJson(200, createSuccessResponse(publicProcs, correlationId));
      return;
    }

    // GET /v1/sources/:id — Retrieve single source
    const singleSourceMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)$/);
    if (req.method === "GET" && singleSourceMatch && singleSourceMatch[1]) {
      const identifier = singleSourceMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }
      const redacted = await redactSourceForPublic(source);
      sendJson(200, createSuccessResponse(redacted, correlationId));
      return;
    }

    // 3. Administrative Mutation Guard
    const enforceAdmin = () => {
      if (!isAdmin) {
        sendError(403, "FORBIDDEN", "Administrative privilege required: SYSTEM_ADMIN or COMPLIANCE_OFFICER.");
        return false;
      }
      return true;
    };

    // POST /v1/sources — Create Source (Atomic Database Transaction)
    if (req.method === "POST" && url.pathname === "/v1/sources") {
      if (!enforceAdmin()) return;

      try {
        const rawBody = await parseBody();
        const parsed = CreateSourceSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid source creation input", parsed.error.issues);
          return;
        }

        const input = parsed.data;

        // Duplicate Check: Canonical Name & Slug must be globally unique
        const existingSlug = await repos.sources.findBySlug(input.slug);
        if (existingSlug) {
          sendError(409, "DUPLICATE_SOURCE_SLUG", `A source with slug '${input.slug}' already exists.`);
          return;
        }

        const existingName = await repos.sources.findByName(input.name);
        if (existingName) {
          sendError(409, "DUPLICATE_SOURCE_NAME", `A source with name '${input.name}' already exists.`);
          return;
        }

        const now = new Date().toISOString();
        const newSource: SourceRecord = {
          id: crypto.randomUUID(),
          name: input.name,
          slug: input.slug,
          displayName: input.displayName || input.name,
          description: input.description || null,
          category: input.category,
          baseUrl: input.baseUrl,
          country: input.country,
          industry: input.industry || null,
          operationalStatus: "ACTIVE",
          rateLimitPerMinute: input.rateLimitPerMinute,
          createdAt: now,
          updatedAt: now
        };

        const outboxMsg = createOutboxMessage(
          "Source",
          newSource.id,
          EventTypes.SOURCE_REGISTERED,
          {
            sourceId: newSource.id,
            name: newSource.name,
            slug: newSource.slug,
            category: newSource.category,
            baseUrl: newSource.baseUrl,
            registeredAt: now
          },
          correlationId
        );

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "CREATE_SOURCE",
          resourceId: newSource.id,
          details: { slug: newSource.slug },
          correlationId
        };

        // Real Atomic Transaction when connected to PostgreSQL
        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.sources.create(newSource, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.sources.create(newSource);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "CREATE_SOURCE", resourceId: newSource.id, actorId, correlationId });
        const redacted = await redactSourceForPublic(newSource);
        sendJson(201, createSuccessResponse(redacted, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to create source");
        return;
      }
    }

    // PATCH /v1/sources/:id — Update Source Metadata (Atomic Transaction)
    if (req.method === "PATCH" && singleSourceMatch && singleSourceMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = singleSourceMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = UpdateSourceSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid source update input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();

        const isRetiring = input.operationalStatus === "RETIRED" || input.operationalStatus === "DISCONTINUED";
        const eventType = isRetiring ? EventTypes.SOURCE_RETIRED : EventTypes.SOURCE_UPDATED;
        const eventPayload = isRetiring
          ? { sourceId: source.id, retiredAt: now, reason: "Source retired by administrator" }
          : { sourceId: source.id, changes: input, updatedAt: now };

        const outboxMsg = createOutboxMessage("Source", source.id, eventType, eventPayload, correlationId);
        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: isRetiring ? "RETIRE_SOURCE" : "UPDATE_SOURCE",
          resourceId: source.id,
          details: { changes: input },
          correlationId
        };

        let updatedSource: SourceRecord | null;

        if (dbPool) {
          updatedSource = await withTransaction(dbPool, async (client) => {
            const res = await repos.sources.update(source.id, input, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
            return res;
          });
        } else {
          updatedSource = await repos.sources.update(source.id, input);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "UPDATE_SOURCE", resourceId: source.id, actorId, correlationId });
        const redacted = await redactSourceForPublic(updatedSource || source);
        sendJson(200, createSuccessResponse(redacted, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to update source");
        return;
      }
    }

    // POST /v1/sources/:id/capabilities — Add Capability (Atomic Transaction)
    if (req.method === "POST" && capsMatch && capsMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = capsMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = AddCapabilitySchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid capability registration input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const existingCaps = await repos.capabilities.findBySourceId(source.id);
        if (existingCaps.some((c) => c.capabilityType === input.capabilityType)) {
          sendError(409, "DUPLICATE_CAPABILITY", `Capability '${input.capabilityType}' already registered for source`);
          return;
        }

        const now = new Date().toISOString();
        const newCap: SourceCapabilityRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          capabilityType: input.capabilityType,
          supportedIdentifierTypes: input.supportedIdentifierTypes,
          accessMethod: input.accessMethod,
          applicableRestrictions: input.applicableRestrictions,
          complianceEndpoint: input.complianceEndpoint,
          grievanceOfficerEmail: input.grievanceOfficerEmail,
          status: SourceCapabilityStatus.PLANNED,
          verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
          lastReviewedAt: null,
          reviewNotes: "Registered capability awaiting evidence verification.",
          createdAt: now,
          updatedAt: now
        };

        const outboxMsg = createOutboxMessage(
          "SourceCapability",
          newCap.id,
          EventTypes.SOURCE_CAPABILITY_UPDATED,
          {
            sourceId: source.id,
            capabilityType: newCap.capabilityType,
            status: newCap.status,
            verificationStatus: newCap.verificationStatus,
            updatedAt: now
          },
          correlationId
        );

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "ADD_CAPABILITY",
          resourceId: newCap.id,
          details: { sourceId: source.id, type: newCap.capabilityType },
          correlationId
        };

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.capabilities.create(newCap, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.capabilities.create(newCap);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "ADD_CAPABILITY", resourceId: newCap.id, actorId, correlationId });
        sendJson(201, createSuccessResponse(newCap, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to add capability");
        return;
      }
    }

    // PATCH /v1/sources/:id/capabilities/:capId — Update Capability Lifecycle (Atomic Transaction)
    const singleCapMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/capabilities\/([^/]+)$/);
    if (req.method === "PATCH" && singleCapMatch && singleCapMatch[1] && singleCapMatch[2]) {
      if (!enforceAdmin()) return;

      const identifier = singleCapMatch[1];
      const capId = singleCapMatch[2];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      const cap = await repos.capabilities.findById(capId);
      if (!cap || cap.sourceId !== source.id) {
        sendError(404, "CAPABILITY_NOT_FOUND", `Capability '${capId}' not found for source`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = UpdateCapabilityStatusSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid capability status update input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const targetStatus = input.status;
        const targetVerification = input.verificationStatus || cap.verificationStatus;

        // LIFECYCLE CONSTRAINT: Requires verified evidence to become OPERATIONAL or IMPLEMENTED
        if (
          (targetStatus === SourceCapabilityStatus.OPERATIONAL || targetStatus === SourceCapabilityStatus.IMPLEMENTED) &&
          targetVerification !== EvidenceVerificationStatus.VERIFIED
        ) {
          const hasVerified = await repos.evidence.hasVerifiedEvidence(source.id, cap.capabilityType);
          if (!hasVerified) {
            sendError(
              422,
              "EVIDENCE_REQUIRED",
              `Capability cannot transition to '${targetStatus}' without verified supporting evidence. Verified evidence document or verificationStatus=VERIFIED required.`
            );
            return;
          }
        }

        const now = new Date().toISOString();
        const updates: Partial<SourceCapabilityRecord> = {
          status: targetStatus,
          verificationStatus: input.verificationStatus,
          reviewNotes: input.reviewNotes,
          lastReviewedAt: now
        };

        const outboxMsg = createOutboxMessage(
          "SourceCapability",
          cap.id,
          EventTypes.SOURCE_CAPABILITY_UPDATED,
          {
            sourceId: source.id,
            capabilityType: cap.capabilityType,
            status: targetStatus,
            verificationStatus: targetVerification,
            updatedAt: now
          },
          correlationId
        );

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "UPDATE_CAPABILITY_STATUS",
          resourceId: cap.id,
          details: { sourceId: source.id, status: targetStatus, verificationStatus: targetVerification },
          correlationId
        };

        let updatedCap: SourceCapabilityRecord | null;

        if (dbPool) {
          updatedCap = await withTransaction(dbPool, async (client) => {
            const res = await repos.capabilities.update(cap.id, updates, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
            return res;
          });
        } else {
          updatedCap = await repos.capabilities.update(cap.id, updates);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "UPDATE_CAPABILITY_STATUS", resourceId: cap.id, actorId, correlationId });
        sendJson(200, createSuccessResponse(updatedCap || cap, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to update capability status");
        return;
      }
    }

    // POST /v1/sources/:id/evidence — Attach Evidence (Atomic Transaction)
    const evidenceMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/evidence$/);
    if (req.method === "POST" && evidenceMatch && evidenceMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = evidenceMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = AddEvidenceSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid evidence attachment input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();
        const newEvidence: SourceEvidenceRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          capabilityType: input.capabilityType,
          evidenceType: input.evidenceType,
          referenceUrl: input.referenceUrl,
          documentTitle: input.documentTitle,
          observationDate: input.observationDate || now,
          reviewerId: actorId,
          verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
          reviewNotes: input.reviewNotes,
          createdAt: now,
          updatedAt: now
        };

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "ADD_EVIDENCE",
          resourceId: newEvidence.id,
          details: { sourceId: source.id, title: newEvidence.documentTitle, type: newEvidence.evidenceType },
          correlationId
        };

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.evidence.create(newEvidence, client);
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.evidence.create(newEvidence);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "ADD_EVIDENCE", resourceId: newEvidence.id, actorId, correlationId });
        sendJson(201, createSuccessResponse(newEvidence, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to attach evidence");
        return;
      }
    }

    // PATCH /v1/sources/:id/evidence/:evidenceId — Update Evidence Status (Atomic Dispute Cascade)
    const singleEvidenceMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/evidence\/([^/]+)$/);
    if (req.method === "PATCH" && singleEvidenceMatch && singleEvidenceMatch[1] && singleEvidenceMatch[2]) {
      if (!enforceAdmin()) return;

      const identifier = singleEvidenceMatch[1];
      const evidenceId = singleEvidenceMatch[2];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      const evidence = await repos.evidence.findById(evidenceId);
      if (!evidence || evidence.sourceId !== source.id) {
        sendError(404, "EVIDENCE_NOT_FOUND", `Evidence '${evidenceId}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = UpdateEvidenceStatusSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid evidence update input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();

        const isDisputedOrExpired =
          input.verificationStatus === EvidenceVerificationStatus.EXPIRED ||
          input.verificationStatus === EvidenceVerificationStatus.DISPUTED ||
          input.verificationStatus === EvidenceVerificationStatus.REJECTED;

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "UPDATE_EVIDENCE_STATUS",
          resourceId: evidence.id,
          details: { sourceId: source.id, verificationStatus: input.verificationStatus },
          correlationId
        };

        let updatedEvidence: SourceEvidenceRecord | null;

        if (dbPool) {
          updatedEvidence = await withTransaction(dbPool, async (client) => {
            const ev = await repos.evidence.update(evidenceId, input, client);
            if (isDisputedOrExpired) {
              const demoted = await repos.capabilities.demoteOperationalByCapabilityType(
                source.id,
                evidence.capabilityType,
                client
              );
              for (const cap of demoted) {
                const outboxMsg = createOutboxMessage(
                  "SourceCapability",
                  cap.id,
                  EventTypes.SOURCE_POLICY_REVIEW_REQUIRED,
                  {
                    sourceId: source.id,
                    capabilityType: cap.capabilityType,
                    reason: `Evidence '${evidence.documentTitle}' entered status ${input.verificationStatus}`,
                    demotedStatus: cap.status,
                    updatedAt: now
                  },
                  correlationId
                );
                await repos.outbox.create(outboxMsg, client);
              }
            }
            await repos.audit.create(auditEntry, client);
            return ev;
          });
        } else {
          updatedEvidence = await repos.evidence.update(evidenceId, input);
          if (isDisputedOrExpired) {
            const demoted = await repos.capabilities.demoteOperationalByCapabilityType(
              source.id,
              evidence.capabilityType
            );
            for (const cap of demoted) {
              const outboxMsg = createOutboxMessage(
                "SourceCapability",
                cap.id,
                EventTypes.SOURCE_POLICY_REVIEW_REQUIRED,
                {
                  sourceId: source.id,
                  capabilityType: cap.capabilityType,
                  reason: `Evidence '${evidence.documentTitle}' entered status ${input.verificationStatus}`,
                  demotedStatus: cap.status,
                  updatedAt: now
                },
                correlationId
              );
              await repos.outbox.create(outboxMsg);
            }
          }
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "UPDATE_EVIDENCE_STATUS", resourceId: evidence.id, actorId, correlationId });
        sendJson(200, createSuccessResponse(updatedEvidence || evidence, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to update evidence status");
        return;
      }
    }

    // POST /v1/sources/:id/policies — Register Policy (Atomic Transaction)
    const policyMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/policies$/);
    if (req.method === "POST" && policyMatch && policyMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = policyMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = AddPolicySchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid policy registration input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();

        const newPolicy: SourcePolicyRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          termsUrl: input.termsUrl,
          privacyPolicyUrl: input.privacyPolicyUrl,
          accessRestrictions: input.accessRestrictions,
          permittedMethods: input.permittedMethods,
          rateLimitInfo: input.rateLimitInfo,
          personalDataRestrictions: input.personalDataRestrictions,
          removalProcedureRestrictions: input.removalProcedureRestrictions,
          policyReviewDate: now,
          reviewStatus: input.reviewStatus,
          createdAt: now,
          updatedAt: now
        };

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "REGISTER_POLICY",
          resourceId: newPolicy.id,
          details: { sourceId: source.id },
          correlationId
        };

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.policies.create(newPolicy, client);
            if (newPolicy.reviewStatus === SourcePolicyReviewStatus.COMPLIANT) {
              const outboxMsg = createOutboxMessage(
                "SourcePolicy",
                newPolicy.id,
                EventTypes.SOURCE_POLICY_VERIFIED,
                {
                  sourceId: source.id,
                  reviewStatus: newPolicy.reviewStatus,
                  reviewedAt: now,
                  reviewerId: actorId
                },
                correlationId
              );
              await repos.outbox.create(outboxMsg, client);
            }
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.policies.create(newPolicy);
          if (newPolicy.reviewStatus === SourcePolicyReviewStatus.COMPLIANT) {
            const outboxMsg = createOutboxMessage(
              "SourcePolicy",
              newPolicy.id,
              EventTypes.SOURCE_POLICY_VERIFIED,
              {
                sourceId: source.id,
                reviewStatus: newPolicy.reviewStatus,
                reviewedAt: now,
                reviewerId: actorId
              },
              correlationId
            );
            await repos.outbox.create(outboxMsg);
          }
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "REGISTER_POLICY", resourceId: newPolicy.id, actorId, correlationId });
        sendJson(201, createSuccessResponse(newPolicy, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to register policy");
        return;
      }
    }

    // POST /v1/sources/:id/removal-procedures — Register Removal Procedure (Atomic Transaction)
    if (req.method === "POST" && procMatch && procMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = procMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = AddRemovalProcedureSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid removal procedure input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        if (!input.officialRequestUrl && !input.complianceEmail) {
          sendError(400, "VALIDATION_FAILED", "Removal procedure must specify either officialRequestUrl or complianceEmail");
          return;
        }

        const now = new Date().toISOString();
        const newProc: SourceRemovalProcedureRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          submissionMethod: input.submissionMethod,
          officialRequestUrl: input.officialRequestUrl,
          complianceEmail: input.complianceEmail,
          requiredEvidence: input.requiredEvidence,
          requiredUserAuthorization: input.requiredUserAuthorization,
          supportedRequestTypes: input.supportedRequestTypes,
          expectedDocumentation: input.expectedDocumentation,
          isAutomated: input.isAutomated,
          procedureVerificationStatus: EvidenceVerificationStatus.UNVERIFIED,
          lastReviewedAt: now,
          createdAt: now,
          updatedAt: now
        };

        const outboxMsg = createOutboxMessage(
          "SourceRemovalProcedure",
          newProc.id,
          EventTypes.SOURCE_REMOVAL_PROCEDURE_UPDATED,
          {
            sourceId: source.id,
            submissionMethod: newProc.submissionMethod,
            isAutomated: newProc.isAutomated,
            updatedAt: now
          },
          correlationId
        );

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "REGISTER_REMOVAL_PROCEDURE",
          resourceId: newProc.id,
          details: { sourceId: source.id },
          correlationId
        };

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.removalProcedures.create(newProc, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.removalProcedures.create(newProc);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "REGISTER_REMOVAL_PROCEDURE", resourceId: newProc.id, actorId, correlationId });
        sendJson(201, createSuccessResponse(newProc, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to register removal procedure");
        return;
      }
    }

    // POST /v1/sources/:id/integrations — Register Integration (Atomic Transaction)
    const integrationMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/integrations$/);
    if (req.method === "POST" && integrationMatch && integrationMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = integrationMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = RegisterIntegrationSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid integration input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();

        const newIntegration: SourceIntegrationRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          integrationType: input.integrationType,
          accessMethod: input.accessMethod,
          integrationStatus: "PLANNED" as any,
          integrationVersion: input.integrationVersion,
          operationalNotes: input.operationalNotes,
          createdAt: now,
          updatedAt: now
        };

        const outboxMsg = createOutboxMessage(
          "SourceIntegration",
          newIntegration.id,
          EventTypes.SOURCE_INTEGRATION_STATUS_CHANGED,
          {
            sourceId: source.id,
            integrationType: newIntegration.integrationType,
            status: newIntegration.integrationStatus,
            updatedAt: now
          },
          correlationId
        );

        const auditEntry: AuditRecord = {
          id: crypto.randomUUID(),
          timestamp: now,
          actorId,
          actorRoles: userRoles,
          action: "REGISTER_INTEGRATION",
          resourceId: newIntegration.id,
          details: { sourceId: source.id },
          correlationId
        };

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.integrations.create(newIntegration, client);
            await repos.outbox.create(outboxMsg, client);
            await repos.audit.create(auditEntry, client);
          });
        } else {
          await repos.integrations.create(newIntegration);
          await repos.outbox.create(outboxMsg);
          await repos.audit.create(auditEntry);
        }

        logger.info("AUDIT", { action: "REGISTER_INTEGRATION", resourceId: newIntegration.id, actorId, correlationId });
        sendJson(201, createSuccessResponse(newIntegration, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to register integration");
        return;
      }
    }

    // POST /v1/sources/:id/health — Record Health Probe (Atomic Transaction)
    const healthMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)\/health$/);
    if (req.method === "POST" && healthMatch && healthMatch[1]) {
      if (!enforceAdmin()) return;

      const identifier = healthMatch[1];
      const source = (await repos.sources.findById(identifier)) || (await repos.sources.findBySlug(identifier));
      if (!source) {
        sendError(404, "SOURCE_NOT_FOUND", `Source '${identifier}' not found`);
        return;
      }

      try {
        const rawBody = await parseBody();
        const parsed = UpdateSourceHealthSchema.safeParse(rawBody);
        if (!parsed.success) {
          sendError(400, "VALIDATION_FAILED", "Invalid health check input", parsed.error.issues);
          return;
        }

        const input = parsed.data;
        const now = new Date().toISOString();

        const record: SourceHealthRecord = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          latencyMs: input.latencyMs,
          httpStatus: input.httpStatus,
          healthStatus: input.healthStatus,
          checkedAt: now
        };

        const newOperationalStatus =
          input.healthStatus === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : input.healthStatus === "DEGRADED"
            ? "DEGRADED"
            : "OPERATIONAL";

        const outboxMsg = createOutboxMessage(
          "SourceHealth",
          record.id,
          EventTypes.SOURCE_HEALTH_CHANGED,
          {
            sourceId: source.id,
            healthStatus: record.healthStatus,
            latencyMs: record.latencyMs,
            httpStatus: record.httpStatus,
            checkedAt: now
          },
          correlationId
        );

        if (dbPool) {
          await withTransaction(dbPool, async (client) => {
            await repos.health.create(record, client);
            await repos.sources.update(source.id, { operationalStatus: newOperationalStatus }, client);
            await repos.outbox.create(outboxMsg, client);
          });
        } else {
          await repos.health.create(record);
          await repos.sources.update(source.id, { operationalStatus: newOperationalStatus });
          await repos.outbox.create(outboxMsg);
        }

        sendJson(201, createSuccessResponse(record, correlationId));
        return;
      } catch (err: any) {
        sendError(500, "INTERNAL_ERROR", err.message || "Failed to record health check");
        return;
      }
    }

    // 4. Internal Outbox & Diagnostics (Protected via X-Internal-Service-Key)
    if (url.pathname === "/internal/outbox/pending") {
      const providedKey = req.headers["x-internal-service-key"] as string | undefined;
      if (!validateInternalServiceKey(providedKey, internalApiKey)) {
        sendError(403, "FORBIDDEN", "Internal service access prohibited.");
        return;
      }
      const pending = await repos.outbox.findPending(100);
      sendJson(200, createSuccessResponse({ pendingCount: pending.length, messages: pending }, correlationId));
      return;
    }

    if (url.pathname === "/internal/audit-logs") {
      if (!isAdmin) {
        sendError(403, "FORBIDDEN", "Administrative privilege required.");
        return;
      }
      const logs = await repos.audit.list(100);
      sendJson(200, createSuccessResponse({ total: logs.length, logs }, correlationId));
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (dbPool) {
      await closeDatabasePool(dbPool);
    }
  };

  return {
    server,
    healthChecker,
    dbPool,
    repos,
    migrator,
    outbox: (repos.outbox as any).messages || [],
    auditLogs: (repos.audit as any).logs || [],
    close
  };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("source-registry-service", env.LOG_LEVEL);
  const { server } = createSourceRegistryServer({
    usePostgres: process.env.USE_POSTGRES === "true"
  });
  const PORT = 4003;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Source Registry Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
