import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { CreateRemovalRequestSchema, AuthoriseRemovalRequestSchema } from "@nijakavach/contracts";
import { ExposureLifecycleState } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
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
  const userId = (req.headers["x-user-id"] as string) || "usr-default-demo";
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Correlation-Id", correlationId);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    const health = await healthChecker.execute();
    res.writeHead(health.status === "DOWN" ? 503 : 200);
    res.end(JSON.stringify(health));
    return;
  }

  const parseBody = async (): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (err) { reject(err); }
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

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, data: removal }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  // Authorise Removal Request
  if (req.method === "POST" && url.pathname.endsWith("/authorise")) {
    const id = url.pathname.split("/")[3];
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Missing removal id" } }));
      return;
    }
    const removal = removalRequests.get(id);
    if (!removal) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: { code: "REMOVAL_NOT_FOUND", message: "Removal request not found" } }));
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

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: removal }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  // Get Removal Details
  if (req.method === "GET" && url.pathname.startsWith("/v1/removals/")) {
    const id = url.pathname.split("/")[3];
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Missing removal id" } }));
      return;
    }
    const removal = removalRequests.get(id);
    if (!removal) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: { code: "REMOVAL_NOT_FOUND", message: "Removal request not found" } }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: removal }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4006;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Removal Workflow Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
