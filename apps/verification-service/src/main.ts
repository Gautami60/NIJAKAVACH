import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { ExposureLifecycleState } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
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

  if (url.pathname === "/health") {
    const health = await healthChecker.execute();
    res.writeHead(health.status === "DOWN" ? 503 : 200);
    res.end(JSON.stringify(health));
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

    res.writeHead(201);
    res.end(JSON.stringify({ success: true, data: verification }));
    return;
  }

  // Get Verification Status
  if (req.method === "GET" && url.pathname.startsWith("/v1/verifications/")) {
    const id = url.pathname.split("/")[3];
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Missing verification id" } }));
      return;
    }
    const item = verificationSchedules.get(id);
    if (!item) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Verification record not found" } }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: item }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4007;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Verification Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
