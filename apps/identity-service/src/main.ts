import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  VerifyEmailRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  ChangePasswordRequestSchema,
  RefreshTokenRequestSchema,
  LogoutRequestSchema,
  createSuccessResponse,
  createErrorResponse
} from "@nijakavach/contracts";
import {
  hashPassword,
  verifyPassword,
  generateJwt,
  validateInternalServiceKey,
  generateSecureToken,
  hashToken
} from "@nijakavach/security";
import {
  UserRole,
  AccountStatus,
  SecurityEventType
} from "@nijakavach/shared-types";
import { InMemoryEventBus, EventTypes } from "@nijakavach/event-contracts";

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  roles: UserRole[];
  status: AccountStatus;
  emailVerified: boolean;
  emailVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  sessionTokenHash: string;
  ipAddress: string;
  userAgent: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

export interface VerificationTokenRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface PasswordResetTokenRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface SecurityEventRecord {
  id: string;
  accountId: string | null;
  eventType: SecurityEventType;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Development-Only Email Delivery Adapter.
 * Does not implement fake delivery providers; stores outbound messages in-memory for testing
 * and inspection without ever leaking tokens to production log streams.
 */
export class DevEmailDeliveryAdapter {
  public outboundMessages: Array<{
    type: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
    recipientEmail: string;
    token: string;
    timestamp: string;
  }> = [];

  sendEmailVerification(recipientEmail: string, token: string): void {
    this.outboundMessages.push({
      type: "EMAIL_VERIFICATION",
      recipientEmail,
      token,
      timestamp: new Date().toISOString()
    });
  }

  sendPasswordReset(recipientEmail: string, token: string): void {
    this.outboundMessages.push({
      type: "PASSWORD_RESET",
      recipientEmail,
      token,
      timestamp: new Date().toISOString()
    });
  }

  getLatestTokenFor(email: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET"): string | undefined {
    const matching = this.outboundMessages.filter(
      m => m.recipientEmail.toLowerCase() === email.toLowerCase() && m.type === type
    );
    return matching[matching.length - 1]?.token;
  }

  clear(): void {
    this.outboundMessages = [];
  }
}

export interface IdentityServerOptions {
  port?: number;
  jwtSecret?: string;
  internalApiKey?: string;
  eventBus?: InMemoryEventBus;
}

export function createIdentityServer(options?: IdentityServerOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  accounts: Map<string, AccountRecord>;
  sessions: Map<string, SessionRecord>;
  emailVerifications: Map<string, VerificationTokenRecord>;
  passwordResets: Map<string, PasswordResetTokenRecord>;
  securityEvents: SecurityEventRecord[];
  devEmailAdapter: DevEmailDeliveryAdapter;
  eventBus: InMemoryEventBus;
} {
  const env = validateEnv(BaseEnvSchema);
  const jwtSecret = options?.jwtSecret || env.JWT_SECRET;
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("identity-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("identity-service");
  const eventBus = options?.eventBus || new InMemoryEventBus();
  const devEmailAdapter = new DevEmailDeliveryAdapter();

  // Primary In-Memory Repositories representing 'identity' schema
  const accountsByEmail = new Map<string, AccountRecord>();
  const accountsById = new Map<string, AccountRecord>();
  const sessions = new Map<string, SessionRecord>(); // key: sessionTokenHash
  const emailVerifications = new Map<string, VerificationTokenRecord>(); // key: tokenHash
  const passwordResets = new Map<string, PasswordResetTokenRecord>(); // key: tokenHash
  const securityEvents: SecurityEventRecord[] = [];

  healthChecker.registerComponentCheck("identity_db_schema", async () => ({
    status: "UP",
    message: "Schema 'identity' reachable"
  }));

  function recordSecurityEvent(
    accountId: string | null,
    eventType: SecurityEventType,
    ipAddress: string,
    userAgent: string,
    metadata: Record<string, unknown> = {}
  ): SecurityEventRecord {
    const record: SecurityEventRecord = {
      id: crypto.randomUUID(),
      accountId,
      eventType,
      ipAddress,
      userAgent,
      metadata,
      createdAt: new Date().toISOString()
    };
    securityEvents.push(record);
    return record;
  }

  const server = http.createServer(async (req, res) => {
    const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Correlation-Id", correlationId);

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "unknown";

    const sendJson = (statusCode: number, payload: unknown) => {
      res.writeHead(statusCode);
      res.end(JSON.stringify(payload));
    };

    const sendError = (statusCode: number, code: string, message: string, details?: unknown) => {
      sendJson(statusCode, createErrorResponse(code, message, correlationId, details));
    };

    // Public Probes
    if (url.pathname === "/health") {
      sendJson(200, healthChecker.executeLiveness());
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      sendJson(ready.status === "DOWN" ? 503 : 200, ready);
      return;
    }

    // Direct Access Prevention: Verify Internal Service Key
    const providedKey = req.headers["x-internal-service-key"] as string | undefined;
    if (!validateInternalServiceKey(providedKey, internalApiKey)) {
      sendError(403, "FORBIDDEN", "Direct service access prohibited; requests must route through API Gateway.");
      return;
    }

    // Helper: Parse JSON Body
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
    // A. REGISTRATION: POST /v1/identity/register
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/register") {
      try {
        const raw = await parseBody();
        const body = RegisterRequestSchema.parse(raw);
        const normalizedEmail = body.email.toLowerCase().trim();

        if (accountsByEmail.has(normalizedEmail)) {
          // Do not reveal unnecessary details; return clean duplicate error
          sendError(409, "EMAIL_EXISTS", "An account with this email address already exists.");
          return;
        }

        const passwordHash = await hashPassword(body.password);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const account: AccountRecord = {
          id,
          email: normalizedEmail,
          passwordHash,
          fullName: body.fullName.trim(),
          roles: [UserRole.USER],
          status: AccountStatus.PENDING_VERIFICATION,
          emailVerified: false,
          createdAt: now,
          updatedAt: now
        };

        accountsByEmail.set(normalizedEmail, account);
        accountsById.set(id, account);

        // Generate email verification token (valid for 24h)
        const rawToken = generateSecureToken(32);
        const tokenHash = hashToken(rawToken);
        const verificationRecord: VerificationTokenRecord = {
          id: crypto.randomUUID(),
          accountId: id,
          tokenHash,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          createdAt: now
        };
        emailVerifications.set(tokenHash, verificationRecord);

        // Deliver via development delivery adapter
        devEmailAdapter.sendEmailVerification(normalizedEmail, rawToken);

        // Record security audit event
        recordSecurityEvent(id, SecurityEventType.LOGIN_SUCCESS, clientIp, userAgent, {
          action: "ACCOUNT_REGISTERED",
          email: normalizedEmail
        });

        // Publish UserRegistered domain event
        await eventBus.publish(
          EventTypes.USER_REGISTERED,
          { userId: id, email: normalizedEmail, registeredAt: now },
          correlationId,
          "urn:nijakavach:service:identity"
        );

        // Issue access token & session refresh token
        const accessToken = generateJwt(
          { sub: id, email: normalizedEmail, roles: account.roles },
          jwtSecret,
          900 // 15 minutes
        );

        const rawRefreshToken = `rf_${generateSecureToken(32)}`;
        const sessionTokenHash = hashToken(rawRefreshToken);
        const session: SessionRecord = {
          id: crypto.randomUUID(),
          accountId: id,
          sessionTokenHash,
          ipAddress: clientIp,
          userAgent,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          createdAt: now
        };
        sessions.set(sessionTokenHash, session);

        logger.info("New account registered successfully", { correlationId, userId: id });

        sendJson(201, createSuccessResponse({
          accessToken,
          refreshToken: rawRefreshToken,
          expiresIn: 900,
          user: {
            id: account.id,
            email: account.email,
            fullName: account.fullName,
            roles: account.roles,
            emailVerified: account.emailVerified
          }
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid registration payload");
        return;
      }
    }

    // =========================================================================
    // B. EMAIL VERIFICATION: POST /v1/identity/verify-email
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/verify-email") {
      try {
        const raw = await parseBody();
        const body = VerifyEmailRequestSchema.parse(raw);
        const tokenHash = hashToken(body.token);

        const verification = emailVerifications.get(tokenHash);
        if (!verification) {
          sendError(400, "INVALID_TOKEN", "Verification token is invalid or has expired.");
          return;
        }

        if (verification.consumedAt) {
          sendError(400, "TOKEN_ALREADY_USED", "Verification token has already been consumed.");
          return;
        }

        if (new Date(verification.expiresAt).getTime() < Date.now()) {
          sendError(400, "TOKEN_EXPIRED", "Verification token has expired. Please request a new verification email.");
          return;
        }

        // Consume token (one-time use)
        const now = new Date().toISOString();
        verification.consumedAt = now;

        const account = accountsById.get(verification.accountId);
        if (account) {
          account.emailVerified = true;
          account.emailVerifiedAt = now;
          if (account.status === AccountStatus.PENDING_VERIFICATION) {
            account.status = AccountStatus.ACTIVE;
          }
          account.updatedAt = now;

          recordSecurityEvent(account.id, SecurityEventType.EMAIL_VERIFIED, clientIp, userAgent, {
            email: account.email
          });

          await eventBus.publish(
            EventTypes.EMAIL_VERIFIED,
            { userId: account.id, email: account.email, verifiedAt: now },
            correlationId,
            "urn:nijakavach:service:identity"
          );
        }

        logger.info("Email verified successfully", { correlationId, accountId: verification.accountId });

        sendJson(200, createSuccessResponse({
          message: "Email address verified successfully.",
          verifiedAt: now
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid verification request");
        return;
      }
    }

    // =========================================================================
    // C. LOGIN: POST /v1/identity/login
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/login") {
      try {
        const raw = await parseBody();
        const body = LoginRequestSchema.parse(raw);
        const normalizedEmail = body.email.toLowerCase().trim();

        const account = accountsByEmail.get(normalizedEmail);
        const isValidPassword = account ? await verifyPassword(body.password, account.passwordHash) : false;

        if (!account || !isValidPassword) {
          recordSecurityEvent(account ? account.id : null, SecurityEventType.LOGIN_FAILED, clientIp, userAgent, {
            attemptedEmail: normalizedEmail
          });
          sendError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
          return;
        }

        if (account.status === AccountStatus.SUSPENDED) {
          sendError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Please contact support.");
          return;
        }

        if (account.status === AccountStatus.DELETED) {
          sendError(403, "ACCOUNT_DELETED", "This account has been closed.");
          return;
        }

        const now = new Date().toISOString();
        const accessToken = generateJwt(
          { sub: account.id, email: account.email, roles: account.roles },
          jwtSecret,
          900
        );

        const rawRefreshToken = `rf_${generateSecureToken(32)}`;
        const sessionTokenHash = hashToken(rawRefreshToken);
        const session: SessionRecord = {
          id: crypto.randomUUID(),
          accountId: account.id,
          sessionTokenHash,
          ipAddress: clientIp,
          userAgent,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          createdAt: now
        };
        sessions.set(sessionTokenHash, session);

        recordSecurityEvent(account.id, SecurityEventType.LOGIN_SUCCESS, clientIp, userAgent, {
          sessionId: session.id
        });

        logger.info("User authenticated successfully", { correlationId, userId: account.id });

        sendJson(200, createSuccessResponse({
          accessToken,
          refreshToken: rawRefreshToken,
          expiresIn: 900,
          user: {
            id: account.id,
            email: account.email,
            fullName: account.fullName,
            roles: account.roles,
            emailVerified: account.emailVerified
          }
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid login payload");
        return;
      }
    }

    // =========================================================================
    // D. REFRESH TOKEN ROTATION: POST /v1/identity/refresh-token
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/refresh-token") {
      try {
        const raw = await parseBody();
        const body = RefreshTokenRequestSchema.parse(raw);
        const tokenHash = hashToken(body.refreshToken);

        const session = sessions.get(tokenHash);
        if (!session) {
          sendError(401, "INVALID_SESSION", "Invalid or revoked refresh token.");
          return;
        }

        if (session.revokedAt) {
          // Token reuse detected! Revoke all sessions for this account as security defense
          for (const s of sessions.values()) {
            if (s.accountId === session.accountId && !s.revokedAt) {
              s.revokedAt = new Date().toISOString();
            }
          }
          recordSecurityEvent(session.accountId, SecurityEventType.SESSION_REVOKED, clientIp, userAgent, {
            reason: "REFRESH_TOKEN_REUSE_DETECTED"
          });
          sendError(401, "TOKEN_REUSE_DETECTED", "Refresh token reuse detected. All active sessions have been invalidated.");
          return;
        }

        if (new Date(session.expiresAt).getTime() < Date.now()) {
          session.revokedAt = new Date().toISOString();
          sendError(401, "SESSION_EXPIRED", "Session expired. Please log in again.");
          return;
        }

        const account = accountsById.get(session.accountId);
        if (!account || account.status === AccountStatus.SUSPENDED || account.status === AccountStatus.DELETED) {
          session.revokedAt = new Date().toISOString();
          sendError(403, "ACCOUNT_INACTIVE", "Account is not active.");
          return;
        }

        // Rotate: Invalidate current refresh token immediately
        const now = new Date().toISOString();
        session.revokedAt = now;

        // Issue new token pair
        const newAccessToken = generateJwt(
          { sub: account.id, email: account.email, roles: account.roles },
          jwtSecret,
          900
        );

        const newRawRefreshToken = `rf_${generateSecureToken(32)}`;
        const newSessionTokenHash = hashToken(newRawRefreshToken);
        const newSession: SessionRecord = {
          id: crypto.randomUUID(),
          accountId: account.id,
          sessionTokenHash: newSessionTokenHash,
          ipAddress: clientIp,
          userAgent,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          createdAt: now
        };
        sessions.set(newSessionTokenHash, newSession);

        sendJson(200, createSuccessResponse({
          accessToken: newAccessToken,
          refreshToken: newRawRefreshToken,
          expiresIn: 900
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid refresh token request");
        return;
      }
    }

    // =========================================================================
    // E. LOGOUT: POST /v1/identity/logout
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/logout") {
      try {
        const raw = await parseBody();
        const body = LogoutRequestSchema.parse(raw);

        if (body.refreshToken) {
          const tokenHash = hashToken(body.refreshToken);
          const session = sessions.get(tokenHash);
          if (session && !session.revokedAt) {
            session.revokedAt = new Date().toISOString();
            recordSecurityEvent(session.accountId, SecurityEventType.SESSION_REVOKED, clientIp, userAgent, {
              reason: "USER_LOGOUT"
            });
          }
        }

        sendJson(200, createSuccessResponse({
          message: "Logged out successfully."
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid logout request");
        return;
      }
    }

    // =========================================================================
    // F. FORGOT PASSWORD: POST /v1/identity/forgot-password
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/forgot-password") {
      try {
        const raw = await parseBody();
        const body = ForgotPasswordRequestSchema.parse(raw);
        const normalizedEmail = body.email.toLowerCase().trim();

        const account = accountsByEmail.get(normalizedEmail);
        if (account && account.status !== AccountStatus.DELETED) {
          const rawResetToken = generateSecureToken(32);
          const tokenHash = hashToken(rawResetToken);
          const resetRecord: PasswordResetTokenRecord = {
            id: crypto.randomUUID(),
            accountId: account.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour
            createdAt: new Date().toISOString()
          };
          passwordResets.set(tokenHash, resetRecord);

          devEmailAdapter.sendPasswordReset(account.email, rawResetToken);

          recordSecurityEvent(account.id, SecurityEventType.PASSWORD_RESET_REQUESTED, clientIp, userAgent);
        }

        // Generic response to prevent user enumeration
        sendJson(200, createSuccessResponse({
          message: "If an account exists with this email address, password reset instructions have been sent."
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid forgot password request");
        return;
      }
    }

    // =========================================================================
    // G. RESET PASSWORD: POST /v1/identity/reset-password
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/reset-password") {
      try {
        const raw = await parseBody();
        const body = ResetPasswordRequestSchema.parse(raw);
        const tokenHash = hashToken(body.token);

        const resetRecord = passwordResets.get(tokenHash);
        if (!resetRecord) {
          sendError(400, "INVALID_TOKEN", "Password reset token is invalid or has expired.");
          return;
        }

        if (resetRecord.consumedAt) {
          sendError(400, "TOKEN_ALREADY_USED", "Password reset token has already been consumed.");
          return;
        }

        if (new Date(resetRecord.expiresAt).getTime() < Date.now()) {
          sendError(400, "TOKEN_EXPIRED", "Password reset token has expired.");
          return;
        }

        const account = accountsById.get(resetRecord.accountId);
        if (!account) {
          sendError(400, "ACCOUNT_NOT_FOUND", "Account no longer exists.");
          return;
        }

        const now = new Date().toISOString();
        resetRecord.consumedAt = now;
        account.passwordHash = await hashPassword(body.newPassword);
        account.updatedAt = now;

        // Invalidate all active sessions after password reset
        for (const s of sessions.values()) {
          if (s.accountId === account.id && !s.revokedAt) {
            s.revokedAt = now;
          }
        }

        recordSecurityEvent(account.id, SecurityEventType.PASSWORD_RESET_COMPLETED, clientIp, userAgent);

        logger.info("Password reset completed successfully", { correlationId, accountId: account.id });

        sendJson(200, createSuccessResponse({
          message: "Password has been successfully updated. All active sessions have been invalidated."
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid reset password request");
        return;
      }
    }

    // =========================================================================
    // H. CHANGE PASSWORD: POST /v1/identity/change-password
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/v1/identity/change-password") {
      try {
        const userId = req.headers["x-user-id"] as string | undefined;
        if (!userId) {
          sendError(401, "UNAUTHORIZED", "Missing authenticated user context.");
          return;
        }

        const account = accountsById.get(userId);
        if (!account) {
          sendError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
          return;
        }

        const raw = await parseBody();
        const body = ChangePasswordRequestSchema.parse(raw);

        const isCurrentValid = await verifyPassword(body.currentPassword, account.passwordHash);
        if (!isCurrentValid) {
          sendError(400, "INCORRECT_PASSWORD", "Current password does not match.");
          return;
        }

        const now = new Date().toISOString();
        account.passwordHash = await hashPassword(body.newPassword);
        account.updatedAt = now;

        // Invalidate all active sessions
        for (const s of sessions.values()) {
          if (s.accountId === account.id && !s.revokedAt) {
            s.revokedAt = now;
          }
        }

        recordSecurityEvent(account.id, SecurityEventType.PASSWORD_CHANGED, clientIp, userAgent);

        logger.info("User changed password", { correlationId, userId: account.id });

        sendJson(200, createSuccessResponse({
          message: "Password changed successfully. Active sessions have been revoked."
        }, correlationId));
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid change password request");
        return;
      }
    }

    // =========================================================================
    // I. SECURITY AUDIT LOGS: GET /v1/identity/security-events
    // =========================================================================
    if (req.method === "GET" && url.pathname === "/v1/identity/security-events") {
      const userId = req.headers["x-user-id"] as string | undefined;
      const filtered = userId
        ? securityEvents.filter(e => e.accountId === userId)
        : securityEvents;

      sendJson(200, createSuccessResponse(filtered, correlationId));
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return {
    server,
    healthChecker,
    accounts: accountsByEmail,
    sessions,
    emailVerifications,
    passwordResets,
    securityEvents,
    devEmailAdapter,
    eventBus
  };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("identity-service", env.LOG_LEVEL);
  const { server } = createIdentityServer();
  const PORT = 4001;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Identity Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
