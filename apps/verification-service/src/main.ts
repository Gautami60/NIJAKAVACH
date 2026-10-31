import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { validateInternalServiceKey } from "@nijakavach/security";
import { ExposureLifecycleState } from "@nijakavach/shared-types";

export interface VerificationServerOptions {
  port?: number;
  internalApiKey?: string;
}

export function createVerificationServer(options?: VerificationServerOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  verificationSchedules: Map<string, any>;
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("verification-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("verification-service");

  // In-memory demo store representing verification schema
  const verificationSchedules = new Map<string, any>();

  healthChecker.registerComponentCheck("verification_db_schema", async () => ({
    status: "UP",
    message: "Schema 'verification' reachable"
  }));

  const server = http.createServer(async (req, res) => {
    const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Correlation-Id", correlationId);

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    const sendJson = (statusCode: number, payload: unknown) => {
      res.writeHead(statusCode);
      res.end(JSON.stringify(payload));
    };

    const sendError = (statusCode: number, code: string, message: string) => {
      sendJson(statusCode, {
        success: false,
        error: { code, message },
        requestId: correlationId
      });
    };

    if (url.pathname === "/health") {
      sendJson(200, healthChecker.executeLiveness());
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      sendJson(ready.status === "DOWN" ? 503 : 200, ready);
      return;
    }

    // Validate internal key
    const providedKey = req.headers["x-internal-service-key"] as string | undefined;
    if (!validateInternalServiceKey(providedKey, internalApiKey)) {
      sendError(403, "FORBIDDEN", "Direct service access prohibited; requests must route through API Gateway.");
      return;
    }

    // Schedule Independent Verification Recheck
    if (req.method === "POST" && url.pathname === "/v1/verifications/schedule") {
      const id = crypto.randomUUID();
      const verification = {
        id,
        caseId: "c1111111-1111-4111-c111-111111111111",
        scheduledAt: new Date().toISOString(),
        status: "SCHEDULED_RECHECK",
        independentVerificationStatus: ExposureLifecycleState.UNABLE_TO_VERIFY,
        sourceClaimedRemoved: true,
        lastObservedAt: null
      };

      verificationSchedules.set(id, verification);

      logger.info("Independent verification recheck scheduled", { correlationId, verificationId: id });

      sendJson(201, {
        success: true,
        data: verification,
        requestId: correlationId
      });
      return;
    }

    // Get Verification Status
    if (req.method === "GET" && url.pathname.startsWith("/v1/verifications/")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing verification id");
        return;
      }
      const item = verificationSchedules.get(id);
      if (!item) {
        sendError(404, "VERIFICATION_NOT_FOUND", "Verification record not found");
        return;
      }
      sendJson(200, {
        success: true,
        data: item,
        requestId: correlationId
      });
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return { server, healthChecker, verificationSchedules };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("verification-service", env.LOG_LEVEL);
  const { server } = createVerificationServer();
  const PORT = 4007;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Verification Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
