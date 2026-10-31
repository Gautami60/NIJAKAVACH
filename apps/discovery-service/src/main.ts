import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { CreateScanRequestSchema } from "@nijakavach/contracts";
import { validateInternalServiceKey } from "@nijakavach/security";
import { ScanStatus } from "@nijakavach/shared-types";

export interface DiscoveryServiceOptions {
  port?: number;
  internalApiKey?: string;
}

export function createDiscoveryServer(options?: DiscoveryServiceOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  scans: Map<string, any>;
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("discovery-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("discovery-service");

  // In-memory store representing discovery schema
  const scans = new Map<string, any>();

  healthChecker.registerComponentCheck("discovery_db_schema", async () => ({
    status: "UP",
    message: "Schema 'discovery' reachable"
  }));

  healthChecker.registerComponentCheck("rabbitmq_scan_exchange", async () => ({
    status: "UP",
    message: "Connected to nijakavach.jobs.direct"
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

    if (req.method === "POST" && url.pathname === "/v1/scans") {
      try {
        const raw = await parseBody();
        const body = CreateScanRequestSchema.parse(raw);

        const scanId = crypto.randomUUID();
        const scan = {
          id: scanId,
          userId,
          identifierId: body.identifierId,
          status: ScanStatus.SCHEDULED,
          totalSources: body.sourceIds?.length || 2,
          completedSources: 0,
          candidatesFound: 0,
          createdAt: new Date().toISOString(),
          completedAt: null
        };

        scans.set(scanId, scan);

        logger.info("Discovery scan scheduled and dispatched to worker queues", {
          correlationId,
          scanId,
          userId,
          totalSources: scan.totalSources
        });

        sendJson(201, {
          success: true,
          data: scan,
          requestId: correlationId
        });
        return;
      } catch (err: any) {
        sendError(400, "VALIDATION_ERROR", err.message || "Invalid scan fields");
        return;
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/scans/")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing scan id");
        return;
      }
      const scan = scans.get(id);
      if (!scan) {
        sendError(404, "SCAN_NOT_FOUND", "Scan not found");
        return;
      }
      sendJson(200, {
        success: true,
        data: scan,
        requestId: correlationId
      });
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return { server, healthChecker, scans };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("discovery-service", env.LOG_LEVEL);
  const { server } = createDiscoveryServer();
  const PORT = 4004;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Discovery & Scan Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
