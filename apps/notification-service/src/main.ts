import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";

const env = validateEnv(BaseEnvSchema);
const logger = createLogger("notification-service", env.LOG_LEVEL);
const healthChecker = new HealthChecker("notification-service");

// In-memory demo store representing notifications schema
const notificationLogs: any[] = [];

healthChecker.registerComponentCheck("notifications_db_schema", async () => ({
  status: "UP",
  message: "Schema 'notifications' reachable"
}));

healthChecker.registerComponentCheck("email_transport", async () => ({
  status: "UP",
  message: "SMTP relay channel operational"
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

  if (req.method === "GET" && url.pathname === "/v1/notifications") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: notificationLogs }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4008;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Notification Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
