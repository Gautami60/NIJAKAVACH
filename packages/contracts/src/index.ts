import { z } from "zod";
import {
  ExposureLifecycleState,
  IdentifierType,
  ConsentPurpose,
  StatutoryBasis,
  ScanStatus,
  UserRole
} from "@nijakavach/shared-types";
import {
  EmailSchema,
  PasswordSchema,
  UuidSchema
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

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    roles: z.array(z.nativeEnum(UserRole))
  })
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ==========================================
// 2. User & Consent Contracts
// ==========================================

export const RegisterIdentifierRequestSchema = z.object({
  type: z.nativeEnum(IdentifierType),
  value: z.string().min(3) // Raw value validated conditionally based on type
});
export type RegisterIdentifierRequest = z.infer<typeof RegisterIdentifierRequestSchema>;

export const GrantConsentRequestSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose),
  noticeVersion: z.string().min(1),
  statutoryBasis: z.nativeEnum(StatutoryBasis)
});
export type GrantConsentRequest = z.infer<typeof GrantConsentRequestSchema>;

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
// 6. Generic API Response Envelope
// ==========================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    correlationId: string;
    timestamp: string;
    page?: number;
    limit?: number;
    total?: number;
  };
}
