import * as crypto from "node:crypto";
import { z } from "zod";
import {
  ConsentPurpose,
  StatutoryBasis
} from "@nijakavach/shared-types";

/**
 * Standard CloudEvents v1.0 Envelope Interface
 */
export interface EventEnvelope<T = unknown> {
  specversion: "1.0";
  id: string;
  type: string;
  source: string;
  time: string;
  datacontenttype: "application/json";
  dataversion: string;
  correlationid: string;
  data: T;
}

/**
 * Event Types Registry
 */
export const EventTypes = {
  // Identity
  USER_REGISTERED: "nijakavach.identity.user.registered",
  USER_LOGGED_IN: "nijakavach.identity.user.logged_in",
  EMAIL_VERIFICATION_REQUESTED: "nijakavach.identity.email.verification_requested",
  EMAIL_VERIFIED: "nijakavach.identity.email.verified",
  PASSWORD_RESET_REQUESTED: "nijakavach.identity.password.reset_requested",
  PASSWORD_CHANGED: "nijakavach.identity.password.changed",

  // User Profile & Identifiers
  USER_PROFILE_UPDATED: "nijakavach.user.profile.updated",
  PERSONAL_IDENTIFIER_ADDED: "nijakavach.user.identifier.added",
  PERSONAL_IDENTIFIER_VERIFIED: "nijakavach.user.identifier.verified",
  PERSONAL_IDENTIFIER_REMOVED: "nijakavach.user.identifier.removed",

  // Consent
  CONSENT_GRANTED: "nijakavach.user.consent.granted",
  CONSENT_WITHDRAWN: "nijakavach.user.consent.withdrawn",

  // Authorisation & Data Rights
  ACTION_AUTHORISED: "nijakavach.user.action.authorised",
  AUTHORISATION_REVOKED: "nijakavach.user.action.authorisation_revoked",
  ACCOUNT_DELETION_REQUESTED: "nijakavach.user.account.deletion_requested",

  // Discovery & Scans
  SCAN_REQUESTED: "nijakavach.discovery.scan.requested",
  SCAN_STARTED: "nijakavach.discovery.scan.started",
  SCAN_COMPLETED: "nijakavach.discovery.scan.completed",
  SCAN_FAILED: "nijakavach.discovery.scan.failed",

  // Worker Discoveries
  CANDIDATE_FOUND: "nijakavach.worker.candidate.found",

  // Cases
  MATCH_CONFIRMED: "nijakavach.cases.match.confirmed",
  CANDIDATE_DISMISSED: "nijakavach.cases.candidate.dismissed",

  // Removals
  REMOVAL_AUTHORISED: "nijakavach.removal.authorised",
  REMOVAL_SUBMITTED: "nijakavach.removal.submitted",
  REMOVAL_ACKNOWLEDGED: "nijakavach.removal.acknowledged",
  REMOVAL_REJECTED: "nijakavach.removal.rejected",
  REMOVAL_SOURCE_REPORTED: "nijakavach.removal.source_reported",

  // Verification
  VERIFICATION_REQUESTED: "nijakavach.verification.requested",
  REMOVAL_VERIFIED: "nijakavach.verification.verified",
  REMOVAL_UNVERIFIED: "nijakavach.verification.unverified",
  EXPOSURE_RELISTED: "nijakavach.verification.relisted",

  // Source Registry
  SOURCE_REGISTERED: "nijakavach.sources.source.registered",
  SOURCE_UPDATED: "nijakavach.sources.source.updated",
  SOURCE_RETIRED: "nijakavach.sources.source.retired",
  SOURCE_CAPABILITY_UPDATED: "nijakavach.sources.capability.updated",
  SOURCE_POLICY_REVIEW_REQUIRED: "nijakavach.sources.policy.review_required",
  SOURCE_POLICY_VERIFIED: "nijakavach.sources.policy.verified",
  SOURCE_INTEGRATION_STATUS_CHANGED: "nijakavach.sources.integration.status_changed",
  SOURCE_HEALTH_CHANGED: "nijakavach.sources.health.changed",
  SOURCE_REMOVAL_PROCEDURE_UPDATED: "nijakavach.sources.removal_procedure.updated"
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ==========================================
// Payload Schemas
// ==========================================

export const UserRegisteredPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  registeredAt: z.string()
});
export type UserRegisteredPayload = z.infer<typeof UserRegisteredPayloadSchema>;

export const ConsentGrantedPayloadSchema = z.object({
  consentId: z.string().uuid(),
  userId: z.string().uuid(),
  purpose: z.nativeEnum(ConsentPurpose),
  statutoryBasis: z.nativeEnum(StatutoryBasis),
  noticeVersion: z.string(),
  grantedAt: z.string()
});
export type ConsentGrantedPayload = z.infer<typeof ConsentGrantedPayloadSchema>;

export const ScanRequestedPayloadSchema = z.object({
  scanId: z.string().uuid(),
  userId: z.string().uuid(),
  identifierFingerprint: z.string(),
  sourceIds: z.array(z.string().uuid()),
  requestedAt: z.string()
});
export type ScanRequestedPayload = z.infer<typeof ScanRequestedPayloadSchema>;

export const CandidateFoundPayloadSchema = z.object({
  scanId: z.string().uuid(),
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  identifierFingerprint: z.string(),
  maskedIdentifier: z.string(),
  sourceUrl: z.string().url(),
  evidenceKey: z.string(),
  evidenceHashSha256: z.string().length(64),
  discoveredAt: z.string()
});
export type CandidateFoundPayload = z.infer<typeof CandidateFoundPayloadSchema>;

export const MatchConfirmedPayloadSchema = z.object({
  caseId: z.string().uuid(),
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  confirmedAt: z.string()
});
export type MatchConfirmedPayload = z.infer<typeof MatchConfirmedPayloadSchema>;

export const RemovalAuthorisedPayloadSchema = z.object({
  removalRequestId: z.string().uuid(),
  caseId: z.string().uuid(),
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  statutoryBasis: z.nativeEnum(StatutoryBasis),
  authorisationToken: z.string(),
  authorisedAt: z.string()
});
export type RemovalAuthorisedPayload = z.infer<typeof RemovalAuthorisedPayloadSchema>;

export const RemovalVerifiedPayloadSchema = z.object({
  caseId: z.string().uuid(),
  removalRequestId: z.string().uuid(),
  verifiedAt: z.string(),
  method: z.string()
});
export type RemovalVerifiedPayload = z.infer<typeof RemovalVerifiedPayloadSchema>;

export const ExposureRelistedPayloadSchema = z.object({
  caseId: z.string().uuid(),
  sourceId: z.string().uuid(),
  detectedAt: z.string(),
  newEvidenceKey: z.string()
});
export type ExposureRelistedPayload = z.infer<typeof ExposureRelistedPayloadSchema>;

export const SourceRegisteredPayloadSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  baseUrl: z.string(),
  registeredAt: z.string()
});
export type SourceRegisteredPayload = z.infer<typeof SourceRegisteredPayloadSchema>;

export const SourceUpdatedPayloadSchema = z.object({
  sourceId: z.string().uuid(),
  changes: z.record(z.unknown()),
  updatedAt: z.string()
});
export type SourceUpdatedPayload = z.infer<typeof SourceUpdatedPayloadSchema>;

export const SourceCapabilityUpdatedPayloadSchema = z.object({
  sourceId: z.string().uuid(),
  capabilityType: z.string(),
  status: z.string(),
  verificationStatus: z.string(),
  updatedAt: z.string()
});
export type SourceCapabilityUpdatedPayload = z.infer<typeof SourceCapabilityUpdatedPayloadSchema>;

export const SourceHealthChangedPayloadSchema = z.object({
  sourceId: z.string().uuid(),
  healthStatus: z.string(),
  latencyMs: z.number(),
  httpStatus: z.number(),
  checkedAt: z.string()
});
export type SourceHealthChangedPayload = z.infer<typeof SourceHealthChangedPayloadSchema>;

export const SourcePolicyVerifiedPayloadSchema = z.object({
  sourceId: z.string().uuid(),
  reviewStatus: z.string(),
  reviewedAt: z.string(),
  reviewerId: z.string()
});
export type SourcePolicyVerifiedPayload = z.infer<typeof SourcePolicyVerifiedPayloadSchema>;

// ==========================================
// Transactional Outbox & Event Bus Contracts
// ==========================================

export interface OutboxMessage<T = unknown> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: string;
  payload: T;
  metadata: {
    correlationId: string;
    causationId?: string;
    timestamp: string;
  };
  status: "PENDING" | "DISPATCHED" | "FAILED";
  retryCount: number;
  createdAt: string;
  dispatchedAt?: string;
}

export interface IEventPublisher {
  publish<T>(eventType: string, payload: T, correlationId: string, source?: string): Promise<void>;
  enqueueJob<T>(queueName: string, jobData: T, correlationId: string): Promise<void>;
}

export interface IEventConsumer<T = unknown> {
  handle(envelope: EventEnvelope<T>): Promise<void>;
}

// ==========================================
// CloudEvents & Outbox Helper Functions
// ==========================================

export function createCloudEvent<T>(
  type: string,
  source: string,
  correlationId: string,
  data: T,
  version = "1.0.0"
): EventEnvelope<T> {
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type,
    source,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    dataversion: version,
    correlationid: correlationId,
    data
  };
}

export function createOutboxMessage<T>(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: T,
  correlationId: string,
  version = "1.0.0"
): OutboxMessage<T> {
  return {
    id: crypto.randomUUID(),
    aggregateType,
    aggregateId,
    eventType,
    eventVersion: version,
    payload,
    metadata: {
      correlationId,
      timestamp: new Date().toISOString()
    },
    status: "PENDING",
    retryCount: 0,
    createdAt: new Date().toISOString()
  };
}

/**
 * Calculates exponential backoff with full jitter to avoid thundering herd.
 * Formula: random(0, min(maxMs, baseMs * 2^attempt))
 */
export function calculateBackoffWithJitter(attempt: number, baseMs = 1000, maxMs = 300000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);
  return Math.floor(Math.random() * capped);
}

/**
 * In-memory Idempotency Store with automatic TTL cleanup
 */
export class IdempotencyTracker {
  private records = new Map<string, number>();

  has(key: string): boolean {
    const expiresAt = this.records.get(key);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.records.delete(key);
      return false;
    }
    return true;
  }

  mark(key: string, ttlMs = 86400000): boolean {
    if (this.has(key)) return false;
    this.records.set(key, Date.now() + ttlMs);
    return true;
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Resilient In-Memory & Distributed Message Broker
 * Handles topic publishing, direct work queue dispatch, retry loops,
 * and dead-letter queue routing for failed jobs.
 */
export class InMemoryEventBus implements IEventPublisher {
  private subscribers = new Map<string, Set<(event: EventEnvelope<any>) => Promise<void>>>();
  private queues = new Map<string, Array<{ jobData: any; correlationId: string }>>();
  private deadLetterQueues = new Map<string, Array<{ payload: any; reason: string; timestamp: string }>>();

  async publish<T>(eventType: string, payload: T, correlationId: string, source = "urn:nijakavach:service"): Promise<void> {
    const envelope = createCloudEvent(eventType, source, correlationId, payload);
    const handlers = this.subscribers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(envelope);
      }
    }
  }

  async enqueueJob<T>(queueName: string, jobData: T, correlationId: string): Promise<void> {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
    this.queues.get(queueName)!.push({ jobData, correlationId });
  }

  subscribe<T>(eventType: string, handler: (event: EventEnvelope<T>) => Promise<void>): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    const set = this.subscribers.get(eventType)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  routeToDeadLetter(queueName: string, payload: any, reason: string): void {
    const dlxKey = `${queueName}.dlx`;
    if (!this.deadLetterQueues.has(dlxKey)) {
      this.deadLetterQueues.set(dlxKey, []);
    }
    this.deadLetterQueues.get(dlxKey)!.push({
      payload,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  getDeadLetterCount(queueName: string): number {
    return this.deadLetterQueues.get(`${queueName}.dlx`)?.length || 0;
  }

  getDeadLetterItems(queueName: string): Array<{ payload: any; reason: string; timestamp: string }> {
    return this.deadLetterQueues.get(`${queueName}.dlx`) || [];
  }

  getQueueLength(queueName: string): number {
    return this.queues.get(queueName)?.length || 0;
  }
}

/**
 * Transactional Outbox Dispatcher Engine
 * Reads pending outbox entries, publishes them through the event bus,
 * and updates their status to DISPATCHED or handles retries.
 */
export class OutboxDispatcher {
  private publisher: IEventPublisher;
  private maxRetries: number;

  constructor(publisher: IEventPublisher, maxRetries = 3) {
    this.publisher = publisher;
    this.maxRetries = maxRetries;
  }

  async dispatch(message: OutboxMessage<any>): Promise<{ status: "PENDING" | "DISPATCHED" | "FAILED"; retries: number }> {
    try {
      await this.publisher.publish(
        message.eventType,
        message.payload,
        message.metadata.correlationId,
        `urn:nijakavach:aggregate:${message.aggregateType}:${message.aggregateId}`
      );
      message.status = "DISPATCHED";
      message.dispatchedAt = new Date().toISOString();
      return { status: "DISPATCHED", retries: message.retryCount };
    } catch (err) {
      message.retryCount += 1;
      if (message.retryCount >= this.maxRetries) {
        message.status = "FAILED";
      }
      return { status: message.status, retries: message.retryCount };
    }
  }

  async dispatchBatch(messages: OutboxMessage<any>[]): Promise<void> {
    for (const msg of messages) {
      await this.dispatch(msg);
    }
  }
}

