import { Pool, PoolClient } from "pg";
import {
  SourceRecord,
  SourceCapabilityRecord,
  SourceEvidenceRecord,
  SourceIntegrationRecord,
  SourcePolicyRecord,
  SourceRemovalProcedureRecord,
  SourceHealthRecord,
  AuditRecord,
  SourceListFilter,
  ISourceRepository,
  ISourceCapabilityRepository,
  ISourceEvidenceRepository,
  ISourceIntegrationRepository,
  ISourcePolicyRepository,
  ISourceRemovalProcedureRepository,
  ISourceHealthRepository,
  IOutboxRepository,
  IAuditRepository
} from "./interfaces";
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

type QueryExecutor = Pool | PoolClient;

// ==============================================================================
// 1. PostgreSQL Source Repository
// ==============================================================================

export class PostgresSourceRepository implements ISourceRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRowToSource(row: any): SourceRecord {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      displayName: row.display_name || row.name,
      description: row.description || null,
      category: row.category as SourceCategory,
      baseUrl: row.base_url,
      country: row.country || "IN",
      industry: row.industry || null,
      operationalStatus: row.operational_status,
      rateLimitPerMinute: row.rate_limit_per_minute,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(source: SourceRecord, client?: PoolClient): Promise<SourceRecord> {
    const q = `
      INSERT INTO sources.sources (
        id, name, slug, display_name, description, category,
        base_url, country, industry, operational_status,
        rate_limit_per_minute, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const values = [
      source.id,
      source.name,
      source.slug,
      source.displayName,
      source.description,
      source.category,
      source.baseUrl,
      source.country,
      source.industry,
      source.operationalStatus,
      source.rateLimitPerMinute,
      source.createdAt,
      source.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRowToSource(res.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<SourceRecord | null> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.sources WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (res.rowCount === 0) return null;
    return this.mapRowToSource(res.rows[0]);
  }

  async findBySlug(slug: string, client?: PoolClient): Promise<SourceRecord | null> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.sources WHERE LOWER(slug) = LOWER($1) LIMIT 1;",
      [slug]
    );
    if (res.rowCount === 0) return null;
    return this.mapRowToSource(res.rows[0]);
  }

  async findByName(name: string, client?: PoolClient): Promise<SourceRecord | null> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.sources WHERE LOWER(name) = LOWER($1) LIMIT 1;",
      [name]
    );
    if (res.rowCount === 0) return null;
    return this.mapRowToSource(res.rows[0]);
  }

  async list(filter: SourceListFilter, client?: PoolClient): Promise<{ sources: SourceRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filter.category) {
      conditions.push(`category = $${idx++}`);
      values.push(filter.category);
    }
    if (filter.country) {
      conditions.push(`LOWER(country) LIKE $${idx++}`);
      values.push(`%${filter.country.toLowerCase()}%`);
    }
    if (filter.capability) {
      conditions.push(`id IN (SELECT source_id FROM sources.source_capabilities WHERE capability_type = $${idx++})`);
      values.push(filter.capability);
    }
    if (filter.search) {
      const s = `%${filter.search.toLowerCase()}%`;
      conditions.push(`(
        LOWER(name) LIKE $${idx} OR
        LOWER(display_name) LIKE $${idx} OR
        LOWER(slug) LIKE $${idx} OR
        LOWER(COALESCE(description, '')) LIKE $${idx}
      )`);
      values.push(s);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count Total
    const countRes = await this.getExecutor(client).query(
      `SELECT COUNT(*)::int AS total FROM sources.sources ${whereClause};`,
      values
    );
    const total = countRes.rows[0].total;

    // Fetch Paginated Rows
    const limit = filter.limit;
    const offset = (filter.page - 1) * filter.limit;
    const query = `
      SELECT * FROM sources.sources
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    values.push(limit, offset);

    const res = await this.getExecutor(client).query(query, values);
    return {
      sources: res.rows.map(this.mapRowToSource),
      total
    };
  }

  async update(id: string, updates: Partial<SourceRecord>, client?: PoolClient): Promise<SourceRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.displayName !== undefined) {
      fields.push(`display_name = $${idx++}`);
      values.push(updates.displayName);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(updates.description);
    }
    if (updates.category !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(updates.category);
    }
    if (updates.baseUrl !== undefined) {
      fields.push(`base_url = $${idx++}`);
      values.push(updates.baseUrl);
    }
    if (updates.country !== undefined) {
      fields.push(`country = $${idx++}`);
      values.push(updates.country);
    }
    if (updates.industry !== undefined) {
      fields.push(`industry = $${idx++}`);
      values.push(updates.industry);
    }
    if (updates.operationalStatus !== undefined) {
      fields.push(`operational_status = $${idx++}`);
      values.push(updates.operationalStatus);
    }
    if (updates.rateLimitPerMinute !== undefined) {
      fields.push(`rate_limit_per_minute = $${idx++}`);
      values.push(updates.rateLimitPerMinute);
    }

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const q = `
      UPDATE sources.sources
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;

    const res = await this.getExecutor(client).query(q, values);
    if (res.rowCount === 0) return null;
    return this.mapRowToSource(res.rows[0]);
  }

  async countByCategory(client?: PoolClient): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const cat of Object.values(SourceCategory)) {
      counts[cat] = 0;
    }
    const res = await this.getExecutor(client).query(
      "SELECT category, COUNT(*)::int AS count FROM sources.sources GROUP BY category;"
    );
    for (const r of res.rows) {
      counts[r.category] = r.count;
    }
    return counts;
  }
}

// ==============================================================================
// 2. PostgreSQL Source Capability Repository
// ==============================================================================

export class PostgresSourceCapabilityRepository implements ISourceCapabilityRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRowToCapability(row: any): SourceCapabilityRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      capabilityType: row.capability_type as SourceCapabilityType,
      supportedIdentifierTypes: row.supported_identifier_types as IdentifierType[],
      accessMethod: row.access_method,
      applicableRestrictions: row.applicable_restrictions || undefined,
      complianceEndpoint: row.compliance_endpoint || undefined,
      grievanceOfficerEmail: row.grievance_officer_email || undefined,
      status: row.status as SourceCapabilityStatus,
      verificationStatus: row.verification_status as EvidenceVerificationStatus,
      lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null,
      reviewNotes: row.review_notes || undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(capability: SourceCapabilityRecord, client?: PoolClient): Promise<SourceCapabilityRecord> {
    const q = `
      INSERT INTO sources.source_capabilities (
        id, source_id, capability_type, supported_identifier_types,
        access_method, applicable_restrictions, compliance_endpoint,
        grievance_officer_email, status, verification_status,
        last_reviewed_at, review_notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;
    const values = [
      capability.id,
      capability.sourceId,
      capability.capabilityType,
      capability.supportedIdentifierTypes,
      capability.accessMethod,
      capability.applicableRestrictions || null,
      capability.complianceEndpoint || null,
      capability.grievanceOfficerEmail || null,
      capability.status,
      capability.verificationStatus,
      capability.lastReviewedAt,
      capability.reviewNotes || null,
      capability.createdAt,
      capability.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRowToCapability(res.rows[0]);
  }

  async findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceCapabilityRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_capabilities WHERE source_id = $1 ORDER BY created_at ASC;",
      [sourceId]
    );
    return res.rows.map(this.mapRowToCapability);
  }

  async findById(id: string, client?: PoolClient): Promise<SourceCapabilityRecord | null> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_capabilities WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (res.rowCount === 0) return null;
    return this.mapRowToCapability(res.rows[0]);
  }

  async update(id: string, updates: Partial<SourceCapabilityRecord>, client?: PoolClient): Promise<SourceCapabilityRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.verificationStatus !== undefined) {
      fields.push(`verification_status = $${idx++}`);
      values.push(updates.verificationStatus);
    }
    if (updates.reviewNotes !== undefined) {
      fields.push(`review_notes = $${idx++}`);
      values.push(updates.reviewNotes);
    }
    if (updates.lastReviewedAt !== undefined) {
      fields.push(`last_reviewed_at = $${idx++}`);
      values.push(updates.lastReviewedAt);
    }

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const q = `
      UPDATE sources.source_capabilities
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;
    const res = await this.getExecutor(client).query(q, values);
    if (res.rowCount === 0) return null;
    return this.mapRowToCapability(res.rows[0]);
  }

  async demoteOperationalByCapabilityType(
    sourceId: string,
    capabilityType?: SourceCapabilityType,
    client?: PoolClient
  ): Promise<SourceCapabilityRecord[]> {
    let q: string;
    let values: any[];

    if (capabilityType) {
      q = `
        UPDATE sources.source_capabilities
        SET status = 'UNDER_REVIEW', updated_at = NOW()
        WHERE source_id = $1 AND capability_type = $2 AND status = 'OPERATIONAL'
        RETURNING *;
      `;
      values = [sourceId, capabilityType];
    } else {
      q = `
        UPDATE sources.source_capabilities
        SET status = 'UNDER_REVIEW', updated_at = NOW()
        WHERE source_id = $1 AND status = 'OPERATIONAL'
        RETURNING *;
      `;
      values = [sourceId];
    }

    const res = await this.getExecutor(client).query(q, values);
    return res.rows.map(this.mapRowToCapability);
  }
}

// ==============================================================================
// 3. PostgreSQL Source Evidence Repository
// ==============================================================================

export class PostgresSourceEvidenceRepository implements ISourceEvidenceRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRowToEvidence(row: any): SourceEvidenceRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      capabilityType: row.capability_type as SourceCapabilityType | undefined,
      evidenceType: row.evidence_type as SourceEvidenceType,
      referenceUrl: row.reference_url,
      documentTitle: row.document_title,
      observationDate: new Date(row.observation_date).toISOString(),
      reviewerId: row.reviewer_id,
      verificationStatus: row.verification_status as EvidenceVerificationStatus,
      reviewNotes: row.review_notes || undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(evidence: SourceEvidenceRecord, client?: PoolClient): Promise<SourceEvidenceRecord> {
    const q = `
      INSERT INTO sources.source_evidence (
        id, source_id, capability_type, evidence_type, reference_url,
        document_title, observation_date, reviewer_id, verification_status,
        review_notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const values = [
      evidence.id,
      evidence.sourceId,
      evidence.capabilityType || null,
      evidence.evidenceType,
      evidence.referenceUrl,
      evidence.documentTitle,
      evidence.observationDate,
      evidence.reviewerId,
      evidence.verificationStatus,
      evidence.reviewNotes || null,
      evidence.createdAt,
      evidence.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRowToEvidence(res.rows[0]);
  }

  async findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceEvidenceRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_evidence WHERE source_id = $1 ORDER BY created_at DESC;",
      [sourceId]
    );
    return res.rows.map(this.mapRowToEvidence);
  }

  async findById(id: string, client?: PoolClient): Promise<SourceEvidenceRecord | null> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_evidence WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (res.rowCount === 0) return null;
    return this.mapRowToEvidence(res.rows[0]);
  }

  async update(id: string, updates: Partial<SourceEvidenceRecord>, client?: PoolClient): Promise<SourceEvidenceRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.verificationStatus !== undefined) {
      fields.push(`verification_status = $${idx++}`);
      values.push(updates.verificationStatus);
    }
    if (updates.reviewNotes !== undefined) {
      fields.push(`review_notes = $${idx++}`);
      values.push(updates.reviewNotes);
    }

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const q = `
      UPDATE sources.source_evidence
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;
    const res = await this.getExecutor(client).query(q, values);
    if (res.rowCount === 0) return null;
    return this.mapRowToEvidence(res.rows[0]);
  }

  async hasVerifiedEvidence(sourceId: string, capabilityType?: SourceCapabilityType, client?: PoolClient): Promise<boolean> {
    const q = `
      SELECT 1 FROM sources.source_evidence
      WHERE source_id = $1 AND verification_status = 'VERIFIED'
        AND ($2::text IS NULL OR capability_type = $2 OR capability_type IS NULL)
      LIMIT 1;
    `;
    const res = await this.getExecutor(client).query(q, [sourceId, capabilityType || null]);
    return res.rowCount !== null && res.rowCount > 0;
  }
}

// ==============================================================================
// 4. PostgreSQL Source Integration Repository
// ==============================================================================

export class PostgresSourceIntegrationRepository implements ISourceIntegrationRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRow(row: any): SourceIntegrationRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      integrationType: row.integration_type as SourceIntegrationType,
      accessMethod: row.access_method as SourceAccessMethod,
      integrationStatus: row.integration_status as SourceIntegrationStatus,
      integrationVersion: row.integration_version,
      operationalNotes: row.operational_notes || undefined,
      lastSuccessfulExecution: row.last_successful_execution ? new Date(row.last_successful_execution).toISOString() : undefined,
      lastFailedExecution: row.last_failed_execution ? new Date(row.last_failed_execution).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(integration: SourceIntegrationRecord, client?: PoolClient): Promise<SourceIntegrationRecord> {
    const q = `
      INSERT INTO sources.source_integrations (
        id, source_id, integration_type, access_method, integration_status,
        integration_version, operational_notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const values = [
      integration.id,
      integration.sourceId,
      integration.integrationType,
      integration.accessMethod,
      integration.integrationStatus,
      integration.integrationVersion,
      integration.operationalNotes || null,
      integration.createdAt,
      integration.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRow(res.rows[0]);
  }

  async findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceIntegrationRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_integrations WHERE source_id = $1 ORDER BY created_at DESC;",
      [sourceId]
    );
    return res.rows.map(this.mapRow);
  }
}

// ==============================================================================
// 5. PostgreSQL Source Policy Repository
// ==============================================================================

export class PostgresSourcePolicyRepository implements ISourcePolicyRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRow(row: any): SourcePolicyRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      termsUrl: row.terms_url || undefined,
      privacyPolicyUrl: row.privacy_policy_url || undefined,
      accessRestrictions: row.access_restrictions || undefined,
      permittedMethods: row.permitted_methods || [],
      rateLimitInfo: row.rate_limit_info || undefined,
      personalDataRestrictions: row.personal_data_restrictions || undefined,
      removalProcedureRestrictions: row.removal_procedure_restrictions || undefined,
      policyReviewDate: row.policy_review_date ? new Date(row.policy_review_date).toISOString() : undefined,
      reviewStatus: row.review_status as SourcePolicyReviewStatus,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(policy: SourcePolicyRecord, client?: PoolClient): Promise<SourcePolicyRecord> {
    const q = `
      INSERT INTO sources.source_policies (
        id, source_id, terms_url, privacy_policy_url, access_restrictions,
        permitted_methods, rate_limit_info, personal_data_restrictions,
        removal_procedure_restrictions, policy_review_date, review_status,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const values = [
      policy.id,
      policy.sourceId,
      policy.termsUrl || null,
      policy.privacyPolicyUrl || null,
      policy.accessRestrictions || null,
      policy.permittedMethods,
      policy.rateLimitInfo || null,
      policy.personalDataRestrictions || null,
      policy.removalProcedureRestrictions || null,
      policy.policyReviewDate || null,
      policy.reviewStatus,
      policy.createdAt,
      policy.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRow(res.rows[0]);
  }

  async findBySourceId(sourceId: string, client?: PoolClient): Promise<SourcePolicyRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_policies WHERE source_id = $1 ORDER BY created_at DESC;",
      [sourceId]
    );
    return res.rows.map(this.mapRow);
  }
}

// ==============================================================================
// 6. PostgreSQL Source Removal Procedure Repository
// ==============================================================================

export class PostgresSourceRemovalProcedureRepository implements ISourceRemovalProcedureRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRow(row: any): SourceRemovalProcedureRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      submissionMethod: row.submission_method as SourceSubmissionMethod,
      officialRequestUrl: row.official_request_url || undefined,
      complianceEmail: row.compliance_email || undefined,
      requiredEvidence: row.required_evidence || undefined,
      requiredUserAuthorization: row.required_user_authorization || undefined,
      supportedRequestTypes: row.supported_request_types || [],
      expectedDocumentation: row.expected_documentation || undefined,
      isAutomated: row.is_automated,
      procedureVerificationStatus: row.procedure_verification_status as EvidenceVerificationStatus,
      lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async create(proc: SourceRemovalProcedureRecord, client?: PoolClient): Promise<SourceRemovalProcedureRecord> {
    const q = `
      INSERT INTO sources.source_removal_procedures (
        id, source_id, submission_method, official_request_url, compliance_email,
        required_evidence, required_user_authorization, supported_request_types,
        expected_documentation, is_automated, procedure_verification_status,
        last_reviewed_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;
    const values = [
      proc.id,
      proc.sourceId,
      proc.submissionMethod,
      proc.officialRequestUrl || null,
      proc.complianceEmail || null,
      proc.requiredEvidence || null,
      proc.requiredUserAuthorization || null,
      proc.supportedRequestTypes,
      proc.expectedDocumentation || null,
      proc.isAutomated,
      proc.procedureVerificationStatus,
      proc.lastReviewedAt || null,
      proc.createdAt,
      proc.updatedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRow(res.rows[0]);
  }

  async findBySourceId(sourceId: string, client?: PoolClient): Promise<SourceRemovalProcedureRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_removal_procedures WHERE source_id = $1 ORDER BY created_at DESC;",
      [sourceId]
    );
    return res.rows.map(this.mapRow);
  }
}

// ==============================================================================
// 7. PostgreSQL Source Health Repository
// ==============================================================================

export class PostgresSourceHealthRepository implements ISourceHealthRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  private mapRow(row: any): SourceHealthRecord {
    return {
      id: row.id,
      sourceId: row.source_id,
      latencyMs: row.latency_ms,
      httpStatus: row.http_status,
      healthStatus: row.health_status as SourceHealthStatus,
      checkedAt: new Date(row.checked_at).toISOString()
    };
  }

  async create(record: SourceHealthRecord, client?: PoolClient): Promise<SourceHealthRecord> {
    const q = `
      INSERT INTO sources.source_health_records (
        id, source_id, latency_ms, http_status, health_status, checked_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [
      record.id,
      record.sourceId,
      record.latencyMs,
      record.httpStatus,
      record.healthStatus,
      record.checkedAt
    ];
    const res = await this.getExecutor(client).query(q, values);
    return this.mapRow(res.rows[0]);
  }

  async findBySourceId(sourceId: string, limit = 50, client?: PoolClient): Promise<SourceHealthRecord[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.source_health_records WHERE source_id = $1 ORDER BY checked_at DESC LIMIT $2;",
      [sourceId, limit]
    );
    return res.rows.map(this.mapRow);
  }
}

// ==============================================================================
// 8. PostgreSQL Transactional Outbox Repository
// ==============================================================================

export class PostgresOutboxRepository implements IOutboxRepository {
  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  async create(message: OutboxMessage, client?: PoolClient): Promise<void> {
    const q = `
      INSERT INTO sources.outbox_messages (
        id, aggregate_type, aggregate_id, event_type, event_version,
        payload, metadata, status, retry_count, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `;
    const values = [
      message.id,
      message.aggregateType,
      message.aggregateId,
      message.eventType,
      message.eventVersion,
      JSON.stringify(message.payload),
      JSON.stringify(message.metadata),
      message.status,
      message.retryCount,
      message.createdAt
    ];
    await this.getExecutor(client).query(q, values);
  }

  async findPending(limit = 100, client?: PoolClient): Promise<OutboxMessage[]> {
    const res = await this.getExecutor(client).query(
      "SELECT * FROM sources.outbox_messages WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT $1;",
      [limit]
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      status: row.status,
      retryCount: row.retry_count,
      createdAt: new Date(row.created_at).toISOString(),
      dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : undefined
    }));
  }

  async updateStatus(id: string, status: "DISPATCHED" | "FAILED", dispatchedAt?: string, client?: PoolClient): Promise<void> {
    await this.getExecutor(client).query(
      "UPDATE sources.outbox_messages SET status = $1, dispatched_at = $2 WHERE id = $3;",
      [status, dispatchedAt || new Date().toISOString(), id]
    );
  }
}

// ==============================================================================
// 9. PostgreSQL Audit Log Repository
// ==============================================================================

export class PostgresAuditRepository implements IAuditRepository {
  private inMemoryFallback: AuditRecord[] = [];

  constructor(private pool: Pool) {}

  private getExecutor(client?: PoolClient): QueryExecutor {
    return client || this.pool;
  }

  async create(entry: AuditRecord, client?: PoolClient): Promise<void> {
    try {
      // Create sources.audit_logs table if not exists for service-owned audit persistence
      await this.getExecutor(client).query(`
        CREATE TABLE IF NOT EXISTS sources.audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actor_id VARCHAR(64) NOT NULL,
          actor_roles VARCHAR(32)[] NOT NULL,
          action VARCHAR(64) NOT NULL,
          resource_id VARCHAR(64) NOT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          correlation_id VARCHAR(64) NOT NULL
        );
      `);

      const q = `
        INSERT INTO sources.audit_logs (
          id, timestamp, actor_id, actor_roles, action, resource_id, details, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `;
      await this.getExecutor(client).query(q, [
        entry.id,
        entry.timestamp,
        entry.actorId,
        entry.actorRoles,
        entry.action,
        entry.resourceId,
        JSON.stringify(entry.details),
        entry.correlationId
      ]);
    } catch {
      // In case table creation is restricted by role DDL limits, store in local fallback
      this.inMemoryFallback.push(entry);
    }
  }

  async list(limit = 100, client?: PoolClient): Promise<AuditRecord[]> {
    try {
      const res = await this.getExecutor(client).query(
        "SELECT * FROM sources.audit_logs ORDER BY timestamp DESC LIMIT $1;",
        [limit]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        timestamp: new Date(row.timestamp).toISOString(),
        actorId: row.actor_id,
        actorRoles: row.actor_roles,
        action: row.action,
        resourceId: row.resource_id,
        details: typeof row.details === "string" ? JSON.parse(row.details) : row.details,
        correlationId: row.correlation_id
      }));
    } catch {
      return this.inMemoryFallback.slice(0, limit);
    }
  }
}

