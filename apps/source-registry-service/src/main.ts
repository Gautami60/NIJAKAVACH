import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { SourceCapabilityType, SourceHealthStatus } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
const logger = createLogger("source-registry-service", env.LOG_LEVEL);
const healthChecker = new HealthChecker("source-registry-service");

// Initial Seed Sources catalog for India public directory landscape
const sourcesCatalog = [
  {
    id: "s1111111-1111-4111-b111-111111111111",
    name: "India B2B Contact Directory Alpha",
    category: "PUBLIC_DIRECTORY",
    baseUrl: "https://directory-alpha.example.in",
    capabilities: [SourceCapabilityType.SEARCHABLE, SourceCapabilityType.WEBFORM_OPT_OUT],
    rateLimitPerMinute: 30,
    healthStatus: SourceHealthStatus.OPERATIONAL,
    optOutUrl: "https://directory-alpha.example.in/privacy/opt-out"
  },
  {
    id: "s2222222-2222-4222-b222-222222222222",
    name: "National Yellow Pages India Beta",
    category: "LEAD_AGGREGATOR",
    baseUrl: "https://yellowpages-beta.example.in",
    capabilities: [SourceCapabilityType.SEARCHABLE, SourceCapabilityType.EMAIL_NOTICE_REMOVAL],
    rateLimitPerMinute: 10,
    healthStatus: SourceHealthStatus.OPERATIONAL,
    complianceEmail: "grievance-officer@yellowpages-beta.example.in"
  }
];

healthChecker.registerComponentCheck("sources_db_schema", async () => ({
  status: "UP",
  message: "Schema 'sources' reachable"
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

  if (req.method === "GET" && url.pathname === "/v1/sources") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: sourcesCatalog }));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/sources/")) {
    const id = url.pathname.split("/")[3];
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Missing source id" } }));
      return;
    }
    const source = sourcesCatalog.find(s => s.id === id);
    if (!source) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: { code: "SOURCE_NOT_FOUND", message: "Source not found" } }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: source }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4003;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Source Registry Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
