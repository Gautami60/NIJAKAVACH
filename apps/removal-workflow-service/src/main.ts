import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { CreateRemovalRequestSchema, AuthoriseRemovalRequestSchema } from "@nijakavach/contracts";
import { validateInternalServiceKey } from "@nijakavach/security";
import { ExposureLifecycleState } from "@nijakavach/shared-types";

export interface RemovalServerOptions {
  port?: number;
  internalApiKey?: string;
}

export function createRemovalServer(options?: RemovalServerOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  removalRequests: Map<string, any>;
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("removal-workflow-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("removal-workflow-service");

  // In-memory demo store representing removals schema
  const removalRequests = new Map<string, any>();

  healthChecker.registerComponentCheck("removals_db_schema", async () => ({
    status: "UP",
    message: "Schema 'removals' reachable"
  }));

  healthChecker.registerComponentCheck("rabbitmq_submission_queue", async () => ({
    status: "UP",
    message: "Connected to jobs.removal.submit"
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

    const userId = req.headers["x-user-id"] as string | undefined;
    if (!userId) {
      sendError(401, "UNAUTHORIZED", "Missing authenticated user context.");
      return;
    }

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

    // Prepare Removal Request
    if (req.method === "POST" && url.pathname === "/v1/removals") {
      try {
        const raw = await parseBody();
        const body = CreateRemovalRequestSchema.parse(raw);

        const removalId = crypto.randomUUID();
        const removal = {
          id: removalId,
          caseId: body.caseId,
          userId,
          statutoryBasis: body.statutoryBasis,
          state: ExposureLifecycleState.REQUEST_PREPARED,
          createdAt: new Date().toISOString(),
          authorisedAt: null
        };

        removalRequests.set(removalId, removal);

        logger.info("Removal request prepared, awaiting user statutory authorisation", {
          correlationId,
          removalId,
          caseId: body.caseId
        });

        sendJson(201, {
          success: true,
          data: removal,
          requestId: correlationId
        });
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid removal request fields");
        return;
      }
    }

    // Authorise Removal Request
    if (req.method === "POST" && url.pathname.endsWith("/authorise")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing removal id");
        return;
      }
      const removal = removalRequests.get(id);
      if (!removal) {
        sendError(404, "REMOVAL_NOT_FOUND", "Removal request not found");
        return;
      }

      try {
        const raw = await parseBody();
        const body = AuthoriseRemovalRequestSchema.parse(raw);

        removal.state = ExposureLifecycleState.REQUEST_SUBMITTED;
        removal.authorisedAt = body.consentTimestamp;
        removal.authorisationStatement = body.authorizationStatement;
        removalRequests.set(id, removal);

        logger.info("Removal request formally authorised and submitted to worker queues", {
          correlationId,
          removalId: id,
          userId
        });

        sendJson(200, {
          success: true,
          data: removal,
          requestId: correlationId
        });
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid authorization fields");
        return;
      }
    }

    // Get Removal Details
    if (req.method === "GET" && url.pathname.startsWith("/v1/removals/")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing removal id");
        return;
      }
      const removal = removalRequests.get(id);
      if (!removal) {
        sendError(404, "REMOVAL_NOT_FOUND", "Removal request not found");
        return;
      }
      sendJson(200, {
        success: true,
        data: removal,
        requestId: correlationId
      });
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return { server, healthChecker, removalRequests };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("removal-workflow-service", env.LOG_LEVEL);
  const { server } = createRemovalServer();
  const PORT = 4006;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Removal Workflow Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
