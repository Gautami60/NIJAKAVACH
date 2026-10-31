import {
  SourceCategory,
  SourceCapabilityType,
  SourceCapabilityStatus,
  EvidenceVerificationStatus,
  SourceAccessMethod,
  SourceSubmissionMethod,
  SourcePolicyReviewStatus,
  SourceEvidenceType,
  SourceIntegrationType,
  SourceIntegrationStatus,
  SourceHealthStatus,
  IdentifierType
} from "@nijakavach/shared-types";
import { OutboxMessage } from "@nijakavach/event-contracts";
import type { PoolClient } from "pg";

export interface SourceRecord {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  description: string | null;
  category: SourceCategory;
  baseUrl: string;
  country: string;
  industry: string | null;
  operationalStatus: string;
  rateLimitPerMinute: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceCapabilityRecord {
  id: string;
  sourceId: string;
  capabilityType: SourceCapabilityType;
  supportedIdentifierTypes: IdentifierType[];
  accessMethod: string;
  applicableRestrictions?: string;
  complianceEndpoint?: string;
  grievanceOfficerEmail?: string;
  status: SourceCapabilityStatus;
  verificationStatus: EvidenceVerificationStatus;
  lastReviewedAt: string | null;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceEvidenceRecord {
  id: string;
  sourceId: string;
  capabilityType?: SourceCapabilityType;
  evidenceType: SourceEvidenceType;
  referenceUrl: string;
  documentTitle: string;
  observationDate: string;
  reviewerId: string;
  verificationStatus: EvidenceVerificationStatus;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceIntegrationRecord {
  id: string;
  sourceId: string;
  integrationType: SourceIntegrationType;
  accessMethod: SourceAccessMethod;
  integrationStatus: SourceIntegrationStatus;
  integrationVersion: string;
  operationalNotes?: string;
  lastSuccessfulExecution?: string;
  lastFailedExecution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourcePolicyRecord {
  id: string;
  sourceId: string;
  termsUrl?: string;
  privacyPolicyUrl?: string;
  accessRestrictions?: string;
  permittedMethods: string[];
  rateLimitInfo?: string;
  personalDataRestrictions?: string;
  removalProcedureRestrictions?: string;
  policyReviewDate?: string;
  reviewStatus: SourcePolicyReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRemovalProcedureRecord {
  id: string;
  sourceId: string;
  submissionMethod: SourceSubmissionMethod;
  officialRequestUrl?: string;
  complianceEmail?: string;
  requiredEvidence?: string;
  requiredUserAuthorization?: string;
  supportedRequestTypes: string[];
  expectedDocumentation?: string;
  isAutomated: boolean;
  procedureVerificationStatus: EvidenceVerificationStatus;
  lastReviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceHealthRecord {
  id: string;
  sourceId: string;
  latencyMs: number;
  httpStatus: number;
  healthStatus: SourceHealthStatus;
  checkedAt: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actorId: string;
  actorRoles: string[];
  action: string;
  resourceId: string;
  details: Record<string, unknown>;
  correlationId: string;
}

export interface SourceListFilter {
  category?: string;
  country?: string;
  capability?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface ISourceRepository {
  create(source: SourceRecord, client?: PoolClient): Promise<SourceRecord>;
  findById(id: string, client?: PoolClient): Promise<SourceRecord | null>;
  findBySlug(slug: string, client?: PoolClient): Promise<SourceRecord | null>;
  findByName(name: string, client?: PoolClient): Promise<SourceRecord | null>;
  list(filter: SourceListFilter, client?: PoolClient): Promise<{ sources: SourceRecord[]; total: number }>;
  update(id: string, updates: Partial<SourceRecord>, client?: PoolClient): Promise<SourceRecord | null>;
  countByCategory(client?: PoolClient): Promise<Record<string, number>>;
}

export interface ISourceCapabilityRepository {
  create(capability: SourceCapabilityRecord, client?: PoolClient): Promise<SourceCapabilityRecord>;
  findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceCapabilityRecord[]>;
  findById(id: string, client?: PoolClient): Promise<SourceCapabilityRecord | null>;
  update(id: string, updates: Partial<SourceCapabilityRecord>, client?: PoolClient): Promise<SourceCapabilityRecord | null>;
  demoteOperationalByCapabilityType(
    sourceId: string,
    capabilityType?: SourceCapabilityType,
    client?: PoolClient
  ): Promise<SourceCapabilityRecord[]>;
}

export interface ISourceEvidenceRepository {
  create(evidence: SourceEvidenceRecord, client?: PoolClient): Promise<SourceEvidenceRecord>;
  findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceEvidenceRecord[]>;
  findById(id: string, client?: PoolClient): Promise<SourceEvidenceRecord | null>;
  update(id: string, updates: Partial<SourceEvidenceRecord>, client?: PoolClient): Promise<SourceEvidenceRecord | null>;
  hasVerifiedEvidence(sourceId: string, capabilityType?: SourceCapabilityType, client?: PoolClient): Promise<boolean>;
}

export interface ISourceIntegrationRepository {
  create(integration: SourceIntegrationRecord, client?: PoolClient): Promise<SourceIntegrationRecord>;
  findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceIntegrationRecord[]>;
}

export interface ISourcePolicyRepository {
  create(policy: SourcePolicyRecord, client?: PoolClient): Promise<SourcePolicyRecord>;
  findBySourceId(sourceId: string, client?: PoolClient): Promise<SourcePolicyRecord[]>;
}

export interface ISourceRemovalProcedureRepository {
  create(proc: SourceRemovalProcedureRecord, client?: PoolClient): Promise<SourceRemovalProcedureRecord>;
  findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceRemovalProcedureRecord[]>;
}

export interface ISourceHealthRepository {
  create(record: SourceHealthRecord, client?: PoolClient): Promise<SourceHealthRecord>;
  findBySourceId(sourceId: string, limit?: number, client?: PoolClient): Promise<SourceHealthRecord[]>;
}

export interface IOutboxRepository {
  create(message: OutboxMessage, client?: PoolClient): Promise<void>;
  findPending(limit?: number, client?: PoolClient): Promise<OutboxMessage[]>;
  updateStatus(id: string, status: "DISPATCHED" | "FAILED", dispatchedAt?: string, client?: PoolClient): Promise<void>;
}

export interface IAuditRepository {
  create(entry: AuditRecord, client?: PoolClient): Promise<void>;
  list(limit?: number, client?: PoolClient): Promise<AuditRecord[]>;
}

