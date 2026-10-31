import { z } from "zod";
import {
  ExposureLifecycleState,
  IdentifierType,
  ConsentPurpose,
  StatutoryBasis,
  ScanStatus,
  UserRole,
  SourceCapabilityType,
  SourceCapabilityStatus,
  EvidenceVerificationStatus,
  SourceCategory,
  SourceAccessMethod,
  SourceSubmissionMethod,
  SourcePolicyReviewStatus,
  SourceEvidenceType,
  SourceIntegrationType,
  SourceHealthStatus
} from "@nijakavach/shared-types";
import {
  EmailSchema,
  PasswordSchema,
  UuidSchema,
  HttpUrlSchema
} from "@nijakavach/validation";

// ==========================================
// 1. Identity & Authentication Contracts
// ==========================================

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  fullName: z.string().trim().min(2).max(100)
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1)
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const VerifyEmailRequestSchema = z.object({
  token: z.string().trim().min(1)
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().trim().min(1),
  newPassword: PasswordSchema
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().trim().min(1)
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().trim().optional()
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    roles: z.array(z.nativeEnum(UserRole)),
    emailVerified: z.boolean().default(false)
  })
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ==========================================
// 2. User Profile, Identifier & Consent Contracts
// ==========================================

export const UpdateProfileRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  locale: z.string().trim().max(10).optional(),
  timezone: z.string().trim().max(64).optional()
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const RegisterIdentifierRequestSchema = z.object({
  type: z.nativeEnum(IdentifierType),
  value: z.string().min(3) // Raw value validated conditionally based on type
});
export type RegisterIdentifierRequest = z.infer<typeof RegisterIdentifierRequestSchema>;

export const VerifyIdentifierRequestSchema = z.object({
  code: z.string().trim().min(4).max(10)
});
export type VerifyIdentifierRequest = z.infer<typeof VerifyIdentifierRequestSchema>;

export const GrantConsentRequestSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose),
  noticeVersion: z.string().min(1),
  statutoryBasis: z.nativeEnum(StatutoryBasis).default(StatutoryBasis.DPDP_ACT_2023_SECTION_6),
  noticeText: z.string().optional()
});
export type GrantConsentRequest = z.infer<typeof GrantConsentRequestSchema>;

export const WithdrawConsentRequestSchema = z.object({
  withdrawalReason: z.string().max(500).optional()
});
export type WithdrawConsentRequest = z.infer<typeof WithdrawConsentRequestSchema>;

export const CreateAuthorisationRequestSchema = z.object({
  caseId: UuidSchema,
  sourceId: UuidSchema,
  authorisationStatement: z.string().min(10).max(2000),
  statutoryBasis: z.nativeEnum(StatutoryBasis).default(StatutoryBasis.DPDP_ACT_2023_SECTION_12)
});
export type CreateAuthorisationRequest = z.infer<typeof CreateAuthorisationRequestSchema>;

export const RevokeAuthorisationRequestSchema = z.object({
  reason: z.string().max(500).optional()
});
export type RevokeAuthorisationRequest = z.infer<typeof RevokeAuthorisationRequestSchema>;

export const CreateDeletionRequestSchema = z.object({
  passwordConfirmation: z.string().min(1),
  reason: z.string().max(1000).optional()
});
export type CreateDeletionRequest = z.infer<typeof CreateDeletionRequestSchema>;

// ==========================================
// 3. Discovery & Scan Contracts
// ==========================================

export const CreateScanRequestSchema = z.object({
  identifierId: UuidSchema,
  sourceIds: z.array(UuidSchema).optional()
});
export type CreateScanRequest = z.infer<typeof CreateScanRequestSchema>;

export const ScanResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  identifierId: z.string(),
  status: z.nativeEnum(ScanStatus),
  totalSources: z.number(),
  completedSources: z.number(),
  candidatesFound: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable()
});
export type ScanResponse = z.infer<typeof ScanResponseSchema>;

// ==========================================
// 4. Case Management Contracts
// ==========================================

export const ConfirmCaseRequestSchema = z.object({
  confirmationNotes: z.string().max(500).optional()
});
export type ConfirmCaseRequest = z.infer<typeof ConfirmCaseRequestSchema>;

export const DismissCaseRequestSchema = z.object({
  reason: z.string().min(3).max(500)
});
export type DismissCaseRequest = z.infer<typeof DismissCaseRequestSchema>;

export const CaseDetailResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  maskedIdentifier: z.string(),
  sourceUrl: z.string(),
  state: z.nativeEnum(ExposureLifecycleState),
  discoveredAt: z.string(),
  evidenceId: z.string().nullable(),
  evidenceViewUrl: z.string().nullable()
});
export type CaseDetailResponse = z.infer<typeof CaseDetailResponseSchema>;

// ==========================================
// 5. Removal Workflow Contracts
// ==========================================

export const CreateRemovalRequestSchema = z.object({
  caseId: UuidSchema,
  statutoryBasis: z.nativeEnum(StatutoryBasis).default(StatutoryBasis.DPDP_ACT_2023_SECTION_12)
});
export type CreateRemovalRequest = z.infer<typeof CreateRemovalRequestSchema>;

export const AuthoriseRemovalRequestSchema = z.object({
  authorizationStatement: z.string().min(10),
  consentTimestamp: z.string()
});
export type AuthoriseRemovalRequest = z.infer<typeof AuthoriseRemovalRequestSchema>;

// ==========================================
// 6. Source Registry & Capability Management Contracts
// ==========================================

export const CreateSourceSchema = z.object({
  name: z.string().trim().min(2).max(128),
  slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/, {
    message: "Slug must contain only lowercase alphanumeric characters and hyphens"
  }),
  displayName: z.string().trim().min(2).max(128).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.nativeEnum(SourceCategory),
  baseUrl: HttpUrlSchema,
  country: z.string().trim().min(2).max(64).default("IN"),
  industry: z.string().trim().max(128).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(30)
});
export type CreateSourceInput = z.infer<typeof CreateSourceSchema>;

export const UpdateSourceSchema = z.object({
  displayName: z.string().trim().min(2).max(128).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.nativeEnum(SourceCategory).optional(),
  baseUrl: HttpUrlSchema.optional(),
  country: z.string().trim().min(2).max(64).optional(),
  industry: z.string().trim().max(128).optional(),
  operationalStatus: z.enum(["ACTIVE", "OPERATIONAL", "DEGRADED", "UNAVAILABLE", "DISCONTINUED", "RETIRED"]).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1000).optional()
});
export type UpdateSourceInput = z.infer<typeof UpdateSourceSchema>;

export const AddCapabilitySchema = z.object({
  capabilityType: z.nativeEnum(SourceCapabilityType),
  supportedIdentifierTypes: z.array(z.nativeEnum(IdentifierType)).min(1),
  accessMethod: z.string().trim().min(2).max(64),
  applicableRestrictions: z.string().max(1000).optional(),
  complianceEndpoint: HttpUrlSchema.optional(),
  grievanceOfficerEmail: EmailSchema.optional()
});
export type AddCapabilityInput = z.infer<typeof AddCapabilitySchema>;

export const UpdateCapabilityStatusSchema = z.object({
  status: z.nativeEnum(SourceCapabilityStatus),
  verificationStatus: z.nativeEnum(EvidenceVerificationStatus).optional(),
  reviewNotes: z.string().max(1000).optional()
});
export type UpdateCapabilityStatusInput = z.infer<typeof UpdateCapabilityStatusSchema>;

export const AddEvidenceSchema = z.object({
  capabilityType: z.nativeEnum(SourceCapabilityType).optional(),
  evidenceType: z.nativeEnum(SourceEvidenceType),
  referenceUrl: HttpUrlSchema,
  documentTitle: z.string().trim().min(2).max(255),
  observationDate: z.string().datetime().optional(),
  reviewNotes: z.string().max(2000).optional()
});
export type AddEvidenceInput = z.infer<typeof AddEvidenceSchema>;

export const UpdateEvidenceStatusSchema = z.object({
  verificationStatus: z.nativeEnum(EvidenceVerificationStatus),
  reviewNotes: z.string().max(2000).optional()
});
export type UpdateEvidenceStatusInput = z.infer<typeof UpdateEvidenceStatusSchema>;

export const AddPolicySchema = z.object({
  termsUrl: HttpUrlSchema.optional(),
  privacyPolicyUrl: HttpUrlSchema.optional(),
  accessRestrictions: z.string().max(2000).optional(),
  permittedMethods: z.array(z.string()).default([]),
  rateLimitInfo: z.string().max(500).optional(),
  personalDataRestrictions: z.string().max(2000).optional(),
  removalProcedureRestrictions: z.string().max(2000).optional(),
  reviewStatus: z.nativeEnum(SourcePolicyReviewStatus).default(SourcePolicyReviewStatus.UNDER_REVIEW)
});
export type AddPolicyInput = z.infer<typeof AddPolicySchema>;

export const AddRemovalProcedureSchema = z.object({
  submissionMethod: z.nativeEnum(SourceSubmissionMethod),
  officialRequestUrl: HttpUrlSchema.optional(),
  complianceEmail: EmailSchema.optional(),
  requiredEvidence: z.string().max(1000).optional(),
  requiredUserAuthorization: z.string().max(1000).optional(),
  supportedRequestTypes: z.array(z.string()).default(["OPTOUT", "DELETION"]),
  expectedDocumentation: z.string().max(1000).optional(),
  isAutomated: z.boolean().default(false)
});
export type AddRemovalProcedureInput = z.infer<typeof AddRemovalProcedureSchema>;

export const RegisterIntegrationSchema = z.object({
  integrationType: z.nativeEnum(SourceIntegrationType),
  accessMethod: z.nativeEnum(SourceAccessMethod),
  integrationVersion: z.string().trim().min(1).max(32).default("1.0.0"),
  operationalNotes: z.string().max(2000).optional()
});
export type RegisterIntegrationInput = z.infer<typeof RegisterIntegrationSchema>;

export const UpdateSourceHealthSchema = z.object({
  latencyMs: z.number().int().min(0),
  httpStatus: z.number().int().min(100).max(599),
  healthStatus: z.nativeEnum(SourceHealthStatus)
});
export type UpdateSourceHealthInput = z.infer<typeof UpdateSourceHealthSchema>;

// Public / Redacted DTOs for Ordinary Users
export const PublicCapabilityResponseSchema = z.object({
  capabilityType: z.nativeEnum(SourceCapabilityType),
  status: z.nativeEnum(SourceCapabilityStatus),
  verificationStatus: z.nativeEnum(EvidenceVerificationStatus),
  supportedIdentifierTypes: z.array(z.nativeEnum(IdentifierType)),
  lastReviewedAt: z.string().nullable()
});
export type PublicCapabilityResponse = z.infer<typeof PublicCapabilityResponseSchema>;

export const PublicSourceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  category: z.nativeEnum(SourceCategory),
  baseUrl: z.string(),
  country: z.string(),
  operationalStatus: z.string(),
  capabilities: z.array(PublicCapabilityResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PublicSourceResponse = z.infer<typeof PublicSourceResponseSchema>;

// ==========================================
// 7. Generic API Response Envelope
// ==========================================

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  requestId: string;
  meta?: {
    timestamp: string;
    page?: number;
    limit?: number;
    total?: number;
  };
}

export function createSuccessResponse<T>(data: T, requestId: string, meta?: ApiResponse["meta"]): ApiResponse<T> {
  return {
    success: true,
    data,
    requestId,
    ...(meta ? { meta } : {})
  };
}

export function createErrorResponse(code: string, message: string, requestId: string, details?: unknown): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {})
    },
    requestId
  };
}
