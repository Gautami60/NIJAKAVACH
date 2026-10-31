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
  IdentifierType
} from "@nijakavach/shared-types";
import { OutboxMessage } from "@nijakavach/event-contracts";
import type { PoolClient } from "pg";

export class MemorySourceRepository implements ISourceRepository {
  public sources = new Map<string, SourceRecord>();

  constructor(initialSources: SourceRecord[] = []) {
    for (const s of initialSources) {
      this.sources.set(s.id, s);
    }
  }

  async create(source: SourceRecord, _client?: PoolClient): Promise<SourceRecord> {
    this.sources.set(source.id, source);
    return source;
  }

  async findById(id: string, _client?: PoolClient): Promise<SourceRecord | null> {
    return this.sources.get(id) || null;
  }

  async findBySlug(slug: string, _client?: PoolClient): Promise<SourceRecord | null> {
    for (const s of this.sources.values()) {
      if (s.slug.toLowerCase() === slug.toLowerCase()) return s;
    }
    return null;
  }

  async findByName(name: string, _client?: PoolClient): Promise<SourceRecord | null> {
    for (const s of this.sources.values()) {
      if (s.name.toLowerCase() === name.toLowerCase()) return s;
    }
    return null;
  }

  async list(filter: SourceListFilter, _client?: PoolClient): Promise<{ sources: SourceRecord[]; total: number }> {
    let list = Array.from(this.sources.values());

    if (filter.category) {
      list = list.filter((s) => s.category === filter.category);
    }
    if (filter.country) {
      list = list.filter((s) => s.country.toLowerCase().includes(filter.country!.toLowerCase()));
    }
    if (filter.search) {
      const s = filter.search.toLowerCase();
      list = list.filter(
        (src) =>
          src.name.toLowerCase().includes(s) ||
          src.displayName.toLowerCase().includes(s) ||
          src.slug.toLowerCase().includes(s) ||
          (src.description && src.description.toLowerCase().includes(s))
      );
    }

    const total = list.length;
    const offset = (filter.page - 1) * filter.limit;
    return {
      sources: list.slice(offset, offset + filter.limit),
      total
    };
  }

  async update(id: string, updates: Partial<SourceRecord>, _client?: PoolClient): Promise<SourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.sources.set(id, updated);
    return updated;
  }

  async countByCategory(_client?: PoolClient): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const cat of Object.values(SourceCategory)) {
      counts[cat] = 0;
    }
    for (const s of this.sources.values()) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }
}

export class MemorySourceCapabilityRepository implements ISourceCapabilityRepository {
  public capabilities = new Map<string, SourceCapabilityRecord[]>();

  constructor(initial: Map<string, SourceCapabilityRecord[]> = new Map()) {
    this.capabilities = initial;
  }

  async create(capability: SourceCapabilityRecord, _client?: PoolClient): Promise<SourceCapabilityRecord> {
    const list = this.capabilities.get(capability.sourceId) || [];
    list.push(capability);
    this.capabilities.set(capability.sourceId, list);
    return capability;
  }

  async findBySourceId(sourceId: string, _client?: PoolClient): Promise<SourceCapabilityRecord[]> {
    return this.capabilities.get(sourceId) || [];
  }

  async findById(id: string, _client?: PoolClient): Promise<SourceCapabilityRecord | null> {
    for (const list of this.capabilities.values()) {
      const found = list.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  }

  async update(id: string, updates: Partial<SourceCapabilityRecord>, _client?: PoolClient): Promise<SourceCapabilityRecord | null> {
    for (const list of this.capabilities.values()) {
      const idx = list.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const updated = {
          ...list[idx]!,
          ...updates,
          updatedAt: new Date().toISOString()
        };
        list[idx] = updated;
        return updated;
      }
    }
    return null;
  }

  async demoteOperationalByCapabilityType(
    sourceId: string,
    capabilityType?: SourceCapabilityType,
    _client?: PoolClient
  ): Promise<SourceCapabilityRecord[]> {
    const list = this.capabilities.get(sourceId) || [];
    const demoted: SourceCapabilityRecord[] = [];
    for (const cap of list) {
      if (!capabilityType || cap.capabilityType === capabilityType) {
        if (cap.status === SourceCapabilityStatus.OPERATIONAL) {
          cap.status = SourceCapabilityStatus.UNDER_REVIEW;
          cap.updatedAt = new Date().toISOString();
          demoted.push(cap);
        }
      }
    }
    return demoted;
  }
}

export class MemorySourceEvidenceRepository implements ISourceEvidenceRepository {
  public evidence = new Map<string, SourceEvidenceRecord[]>();

  async create(evidence: SourceEvidenceRecord, _client?: PoolClient): Promise<SourceEvidenceRecord> {
    const list = this.evidence.get(evidence.sourceId) || [];
    list.push(evidence);
    this.evidence.set(evidence.sourceId, list);
    return evidence;
  }

  async findBySourceId(sourceId: string, _client?: PoolClient): Promise<SourceEvidenceRecord[]> {
    return this.evidence.get(sourceId) || [];
  }

  async findById(id: string, _client?: PoolClient): Promise<SourceEvidenceRecord | null> {
    for (const list of this.evidence.values()) {
      const found = list.find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  }

  async update(id: string, updates: Partial<SourceEvidenceRecord>, _client?: PoolClient): Promise<SourceEvidenceRecord | null> {
    for (const list of this.evidence.values()) {
      const idx = list.findIndex((e) => e.id === id);
      if (idx !== -1) {
        const updated = {
          ...list[idx]!,
          ...updates,
          updatedAt: new Date().toISOString()
        };
        list[idx] = updated;
        return updated;
      }
    }
    return null;
  }

  async hasVerifiedEvidence(sourceId: string, capabilityType?: SourceCapabilityType, _client?: PoolClient): Promise<boolean> {
    const list = this.evidence.get(sourceId) || [];
    return list.some(
      (e) =>
        e.verificationStatus === EvidenceVerificationStatus.VERIFIED &&
        (!e.capabilityType || !capabilityType || e.capabilityType === capabilityType)
    );
  }
}

export class MemorySourceIntegrationRepository implements ISourceIntegrationRepository {
  public integrations = new Map<string, SourceIntegrationRecord[]>();

  async create(integration: SourceIntegrationRecord, _client?: PoolClient): Promise<SourceIntegrationRecord> {
    const list = this.integrations.get(integration.sourceId) || [];
    list.push(integration);
    this.integrations.set(integration.sourceId, list);
    return integration;
  }

  async findBySourceId(sourceId: string, _client?: PoolClient): Promise<SourceIntegrationRecord[]> {
    return this.integrations.get(sourceId) || [];
  }
}

export class MemorySourcePolicyRepository implements ISourcePolicyRepository {
  public policies = new Map<string, SourcePolicyRecord[]>();

  async create(policy: SourcePolicyRecord, _client?: PoolClient): Promise<SourcePolicyRecord> {
    const list = this.policies.get(policy.sourceId) || [];
    list.push(policy);
    this.policies.set(policy.sourceId, list);
    return policy;
  }

  async findBySourceId(sourceId: string, _client?: PoolClient): Promise<SourcePolicyRecord[]> {
    return this.policies.get(sourceId) || [];
  }
}

export class MemorySourceRemovalProcedureRepository implements ISourceRemovalProcedureRepository {
  public procedures = new Map<string, SourceRemovalProcedureRecord[]>();

  async create(proc: SourceRemovalProcedureRecord, _client?: PoolClient): Promise<SourceRemovalProcedureRecord> {
    const list = this.procedures.get(proc.sourceId) || [];
    list.push(proc);
    this.procedures.set(proc.sourceId, list);
    return proc;
  }

  async findBySourceId(sourceId: string, _client?: PoolClient): Promise<SourceRemovalProcedureRecord[]> {
    return this.procedures.get(sourceId) || [];
  }
}

export class MemorySourceHealthRepository implements ISourceHealthRepository {
  public records = new Map<string, SourceHealthRecord[]>();

  async create(record: SourceHealthRecord, _client?: PoolClient): Promise<SourceHealthRecord> {
    const list = this.records.get(record.sourceId) || [];
    list.unshift(record);
    this.records.set(record.sourceId, list);
    return record;
  }

  async findBySourceId(sourceId: string, limit = 50, _client?: PoolClient): Promise<SourceHealthRecord[]> {
    const list = this.records.get(sourceId) || [];
    return list.slice(0, limit);
  }
}

export class MemoryOutboxRepository implements IOutboxRepository {
  public messages: OutboxMessage[] = [];

  async create(message: OutboxMessage, _client?: PoolClient): Promise<void> {
    this.messages.push(message);
  }

  async findPending(limit = 100, _client?: PoolClient): Promise<OutboxMessage[]> {
    return this.messages.filter((m) => m.status === "PENDING").slice(0, limit);
  }

  async updateStatus(id: string, status: "DISPATCHED" | "FAILED", dispatchedAt?: string, _client?: PoolClient): Promise<void> {
    const msg = this.messages.find((m) => m.id === id);
    if (msg) {
      msg.status = status;
      if (dispatchedAt) msg.dispatchedAt = dispatchedAt;
    }
  }
}

export class MemoryAuditRepository implements IAuditRepository {
  public logs: AuditRecord[] = [];

  async create(entry: AuditRecord, _client?: PoolClient): Promise<void> {
    this.logs.push(entry);
  }

  async list(limit = 100, _client?: PoolClient): Promise<AuditRecord[]> {
    return this.logs.slice(0, limit);
  }
}

export function getInitialSeedData(): {
  sources: SourceRecord[];
  capabilities: Map<string, SourceCapabilityRecord[]>;
} {
  const now = "2026-10-31T00:00:00.000Z";

  const sources: SourceRecord[] = [
    {
      id: "s1000000-0000-4000-a000-000000000001",
      name: "Truecaller",
      slug: "truecaller",
      displayName: "Truecaller (Research Candidate)",
      description: "Global caller identification and spam detection platform. Candidate for investigating telephone directory exposure under research protocol.",
      category: SourceCategory.CALLER_ID,
      baseUrl: "https://www.truecaller.com",
      country: "SE / IN",
      industry: "Caller Identification & Telecommunications",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 30,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "s1000000-0000-4000-a000-000000000002",
      name: "Justdial",
      slug: "justdial",
      displayName: "Justdial (Research Candidate)",
      description: "Indian local search engine and commercial directory. Research candidate for public merchant and business contact exposure.",
      category: SourceCategory.PUBLIC_DIRECTORY,
      baseUrl: "https://www.justdial.com",
      country: "IN",
      industry: "Local Search & Commercial Directories",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 30,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "s1000000-0000-4000-a000-000000000003",
      name: "IndiaMART",
      slug: "indiamart",
      displayName: "IndiaMART (Research Candidate)",
      description: "B2B marketplace in India. Candidate for analyzing business contact and vendor catalogue exposure.",
      category: SourceCategory.B2B_DIRECTORY,
      baseUrl: "https://www.indiamart.com",
      country: "IN",
      industry: "B2B Marketplace & E-commerce",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 20,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "s1000000-0000-4000-a000-000000000004",
      name: "Naukri",
      slug: "naukri",
      displayName: "Naukri (Research Candidate)",
      description: "Indian recruitment and professional networking portal. Candidate for professional resume and recruitment contact exposure.",
      category: SourceCategory.RECRUITMENT_PLATFORM,
      baseUrl: "https://www.naukri.com",
      country: "IN",
      industry: "Recruitment & Human Resources",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 15,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "s1000000-0000-4000-a000-000000000005",
      name: "Getcontact",
      slug: "getcontact",
      displayName: "Getcontact (Research Candidate)",
      description: "Caller identification directory and tag system. Candidate for caller identification and tag exposure analysis.",
      category: SourceCategory.CALLER_ID,
      baseUrl: "https://www.getcontact.com",
      country: "GB / IN",
      industry: "Caller Identification & Security",
      operationalStatus: "ACTIVE",
      rateLimitPerMinute: 20,
      createdAt: now,
      updatedAt: now
    }
  ];

  const capabilities = new Map<string, SourceCapabilityRecord[]>();

  capabilities.set("s1000000-0000-4000-a000-000000000001", [
    {
      id: "c1000000-0000-4000-b000-000000000001",
      sourceId: "s1000000-0000-4000-a000-000000000001",
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER],
      accessMethod: "OFFICIAL_PARTNER_INTEGRATION",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "Research candidate. Partner API discovery under legal & technical evaluation.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "c1000000-0000-4000-b000-000000000002",
      sourceId: "s1000000-0000-4000-a000-000000000001",
      capabilityType: SourceCapabilityType.REMOVAL,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER],
      accessMethod: "DOCUMENTED_MANUAL_WORKFLOW",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "Public unlisting webform known but unverified for programmatic integration.",
      createdAt: now,
      updatedAt: now
    }
  ]);

  capabilities.set("s1000000-0000-4000-a000-000000000002", [
    {
      id: "c2000000-0000-4000-b000-000000000001",
      sourceId: "s1000000-0000-4000-a000-000000000002",
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER, IdentifierType.EMAIL_ADDRESS],
      accessMethod: "DOCUMENTED_MANUAL_WORKFLOW",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "Research candidate. Directory listing discovery under legal review.",
      createdAt: now,
      updatedAt: now
    }
  ]);

  capabilities.set("s1000000-0000-4000-a000-000000000003", [
    {
      id: "c3000000-0000-4000-b000-000000000001",
      sourceId: "s1000000-0000-4000-a000-000000000003",
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER, IdentifierType.EMAIL_ADDRESS],
      accessMethod: "DOCUMENTED_MANUAL_WORKFLOW",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "B2B catalog research candidate. No scraping allowed.",
      createdAt: now,
      updatedAt: now
    }
  ]);

  capabilities.set("s1000000-0000-4000-a000-000000000004", [
    {
      id: "c4000000-0000-4000-b000-000000000001",
      sourceId: "s1000000-0000-4000-a000-000000000004",
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.EMAIL_ADDRESS, IdentifierType.PHONE_NUMBER],
      accessMethod: "USER_ASSISTED_WORKFLOW",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "Recruitment portal candidate. Access requires authorized candidate credentials.",
      createdAt: now,
      updatedAt: now
    }
  ]);

  capabilities.set("s1000000-0000-4000-a000-000000000005", [
    {
      id: "c5000000-0000-4000-b000-000000000001",
      sourceId: "s1000000-0000-4000-a000-000000000005",
      capabilityType: SourceCapabilityType.DISCOVERY,
      supportedIdentifierTypes: [IdentifierType.PHONE_NUMBER],
      accessMethod: "OFFICIAL_PARTNER_INTEGRATION",
      status: SourceCapabilityStatus.PLANNED,
      verificationStatus: EvidenceVerificationStatus.UNVERIFIED,
      lastReviewedAt: null,
      reviewNotes: "Candidate under review. Direct scraping prohibited.",
      createdAt: now,
      updatedAt: now
    }
  ]);

  return { sources, capabilities };
}

