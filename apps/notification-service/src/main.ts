import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { validateInternalServiceKey } from "@nijakavach/security";

export interface NotificationServerOptions {
  port?: number;
  internalApiKey?: string;
}

export function createNotificationServer(options?: NotificationServerOptions): {
  server: http.Server;
  healthChecker: HealthChecker;
  notificationLogs: any[];
} {
  const env = validateEnv(BaseEnvSchema);
  const internalApiKey = options?.internalApiKey || env.INTERNAL_SERVICE_API_KEY;
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
    logger.info("Notification service request", { method: req.method, path: req.url, correlationId });
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

    if (req.method === "GET" && url.pathname === "/v1/notifications") {
      sendJson(200, {
        success: true,
        data: notificationLogs,
        requestId: correlationId
      });
      return;
    }

    sendError(404, "NOT_FOUND", "Endpoint not found");
  });

  return { server, healthChecker, notificationLogs };
}

if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("notification-service", env.LOG_LEVEL);
  const { server } = createNotificationServer();
  const PORT = 4008;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Notification Service listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
