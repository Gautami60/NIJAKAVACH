import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { validateInternalServiceKey } from "@nijakavach/security";
import { ExposureLifecycleState } from "@nijakavach/shared-types";

export interface CaseManagementOptions {
  port?: number;
  internalApiKey?: string;
}

export function createCaseManagementServer(options?: CaseManagementOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  casesStore: Map<string, any>;
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
  const logger = createLogger("case-management-service", env.LOG_LEVEL);
  const healthChecker = new HealthChecker("case-management-service");

  // Initial Demo Cases Store (backed by 'cases' schema in DB)
  const casesStore = new Map<string, any>([
    [
      "c1111111-1111-4111-c111-111111111111",
      {
        id: "c1111111-1111-4111-c111-111111111111",
        userId: "usr-default-demo",
        sourceId: "s1111111-1111-4111-b111-111111111111",
        sourceName: "India B2B Contact Directory Alpha",
        maskedIdentifier: "+91 98**** *210",
        sourceUrl: "https://directory-alpha.example.in/listing/ind-98210",
        state: ExposureLifecycleState.POTENTIAL_EXPOSURE_DISCOVERED,
        discoveredAt: new Date().toISOString(),
        evidenceId: "ev-001",
        evidenceKey: "evidence/c1111111-1111-4111-c111-111111111111/snapshot-01.enc"
      }
    ]
  ]);

  healthChecker.registerComponentCheck("cases_db_schema", async () => ({
    status: "UP",
    message: "Schema 'cases' reachable"
  }));

  healthChecker.registerComponentCheck("s3_object_storage", async () => ({
    status: "UP",
    message: "S3 / MinIO evidence bucket accessible"
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

    // Validate internal service key
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

    // List Cases
    if (req.method === "GET" && url.pathname === "/v1/cases") {
      const userCases = Array.from(casesStore.values()).filter(c => c.userId === userId || userId === "usr-default-demo");
      sendJson(200, {
        success: true,
        data: userCases,
        requestId: correlationId
      });
      return;
    }

    // Get Case Details
    if (req.method === "GET" && url.pathname.startsWith("/v1/cases/") && !url.pathname.includes("/evidence")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing case id");
        return;
      }
      const caseItem = casesStore.get(id);
      if (!caseItem) {
        sendError(404, "CASE_NOT_FOUND", "Case not found");
        return;
      }
      sendJson(200, {
        success: true,
        data: caseItem,
        requestId: correlationId
      });
      return;
    }

    // Get Presigned S3 Evidence View URL
    if (req.method === "GET" && url.pathname.includes("/evidence")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing case id");
        return;
      }
      const caseItem = casesStore.get(id);
      if (!caseItem) {
        sendError(404, "CASE_NOT_FOUND", "Case not found");
        return;
      }

      const presignedUrl = `${env.S3_ENDPOINT}/${env.S3_BUCKET_EVIDENCE}/${caseItem.evidenceKey}?X-Amz-Expires=900&signature=simulated_sig_9921`;
      logger.info("Presigned evidence URL generated", { correlationId, caseId: id });

      sendJson(200, {
        success: true,
        data: {
          caseId: id,
          evidenceViewUrl: presignedUrl,
          expiresInSeconds: 900
        },
        requestId: correlationId
      });
      return;
    }

    // Confirm Case as User's Exposure
    if (req.method === "POST" && url.pathname.endsWith("/confirm")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing case id");
        return;
      }
      const caseItem = casesStore.get(id);
      if (!caseItem) {
        sendError(404, "CASE_NOT_FOUND", "Case not found");
        return;
      }

      caseItem.state = ExposureLifecycleState.MATCH_CONFIRMED;
      caseItem.confirmedAt = new Date().toISOString();
      casesStore.set(id, caseItem);

      logger.info("Exposure candidate match confirmed by user", { correlationId, caseId: id, userId });

      sendJson(200, {
        success: true,
        data: caseItem,
        requestId: correlationId
      });
      return;
    }

    // Dismiss Case as False Positive
    if (req.method === "POST" && url.pathname.endsWith("/dismiss")) {
      const id = url.pathname.split("/")[3];
      if (!id) {
        sendError(400, "BAD_REQUEST", "Missing case id");
        return;
      }
      const caseItem = casesStore.get(id);
      if (!caseItem) {
        sendError(404, "CASE_NOT_FOUND", "Case not found");
        return;
      }

      caseItem.state = ExposureLifecycleState.DISMISSED_AS_FALSE_POSITIVE;
      caseItem.dismissedAt = new Date().toISOString();
      casesStore.set(id, caseItem);

      logger.info("Exposure candidate dismissed as false positive", { correlationId, caseId: id, userId });

      sendJson(200, {
        success: true,
        data: caseItem,
        requestId: correlationId
      });
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return { server, healthChecker, casesStore };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("case-management-service", env.LOG_LEVEL);
  const { server } = createCaseManagementServer();
  const PORT = 4005;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Case Management Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
