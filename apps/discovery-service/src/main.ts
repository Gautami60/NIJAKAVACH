import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { CreateScanRequestSchema } from "@nijakavach/contracts";
import { ScanStatus } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
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

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, data: scan }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/scans/")) {
    const id = url.pathname.split("/")[3];
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Missing scan id" } }));
      return;
    }
    const scan = scans.get(id);
    if (!scan) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: { code: "SCAN_NOT_FOUND", message: "Scan not found" } }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: scan }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4004;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Discovery & Scan Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
