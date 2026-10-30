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

  // Consent
  CONSENT_GRANTED: "nijakavach.user.consent.granted",
  CONSENT_WITHDRAWN: "nijakavach.user.consent.withdrawn",

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
  EXPOSURE_RELISTED: "nijakavach.verification.relisted"
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
  publish<T>(eventType: string, payload: T, correlationId: string): Promise<void>;
  enqueueJob<T>(queueName: string, jobData: T, correlationId: string): Promise<void>;
}

export interface IEventConsumer<T = unknown> {
  handle(envelope: EventEnvelope<T>): Promise<void>;
}

