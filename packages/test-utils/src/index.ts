import {
  UserRole,
  ExposureLifecycleState,
  StatutoryBasis
} from "@nijakavach/shared-types";

export function createMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1111111-1111-4111-a111-111111111111",
    email: "consumer.test@nijakavach.in",
    roles: [UserRole.USER],
    fullName: "Priya Sharma",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

export function createMockCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c2222222-2222-4222-a222-222222222222",
    userId: "a1111111-1111-4111-a111-111111111111",
    sourceId: "s3333333-3333-4333-a333-333333333333",
    sourceName: "India Data Aggregator Directory",
    maskedIdentifier: "+91 98**** *210",
    sourceUrl: "https://directory.in/records/98210",
    state: ExposureLifecycleState.POTENTIAL_EXPOSURE_DISCOVERED,
    discoveredAt: new Date().toISOString(),
    evidenceKey: "evidence/test/snapshot-01.enc",
    evidenceHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ...overrides
  };
}

export function createMockRemoval(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r4444444-4444-4444-a444-444444444444",
    caseId: "c2222222-2222-4222-a222-222222222222",
    userId: "a1111111-1111-4111-a111-111111111111",
    statutoryBasis: StatutoryBasis.DPDP_ACT_2023_SECTION_12,
    status: ExposureLifecycleState.REQUEST_PREPARED,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}
