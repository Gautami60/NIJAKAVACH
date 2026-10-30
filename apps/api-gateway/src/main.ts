import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";

const env = validateEnv(BaseEnvSchema);
const logger = createLogger("api-gateway", env.LOG_LEVEL);
const healthChecker = new HealthChecker("api-gateway");

// Register gateway subsystem health check
healthChecker.registerComponentCheck("gateway_router", async () => ({
  status: "UP",
  message: "Routing mesh active and responsive"
}));

const server = http.createServer(async (req, res) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
  const startTime = Date.now();

  // Apply strict security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'");
  res.setHeader("X-Correlation-Id", correlationId);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Correlation-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Health endpoint
  if (url.pathname === "/health") {
    const health = await healthChecker.execute();
    res.writeHead(health.status === "DOWN" ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }

  // Gateway root route
  if (url.pathname === "/" || url.pathname === "/api/v1") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        name: "NIJAKAVACH API Gateway",
        version: "v1",
        status: "OPERATIONAL",
        endpoints: {
          auth: "/api/v1/auth",
          users: "/api/v1/users",
          sources: "/api/v1/sources",
          scans: "/api/v1/scans",
          cases: "/api/v1/cases",
          removals: "/api/v1/removals",
          verifications: "/api/v1/verifications"
        }
      })
    );
    return;
  }

  // Not found fallback
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `Endpoint ${url.pathname} is not registered on this gateway.`
      },
      meta: {
        correlationId,
        timestamp: new Date().toISOString()
      }
    })
  );

  logger.info(`Request processed: ${req.method} ${url.pathname}`, {
    correlationId,
    statusCode: res.statusCode,
    durationMs: Date.now() - startTime
  });
});

const PORT = env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH API Gateway listening on port ${PORT}`);
});

function handleShutdown(signal: string) {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);
  server.close(() => {
    logger.info("HTTP server closed successfully.");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Forceful shutdown invoked after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
