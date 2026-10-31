import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger, LogLevel } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { authenticateBearerToken } from "@nijakavach/security";

export interface GatewayRouteTarget {
  prefix: string;
  targetHost: string;
  targetPort: number;
  rewritePrefix: string;
  requireAuth: boolean;
}

export interface GatewayConfig {
  port: number;
  jwtSecret: string;
  internalApiKey: string;
  logLevel?: LogLevel;
  requestTimeoutMs?: number;
  maxBodySizeBytes?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  routes?: GatewayRouteTarget[];
}

/**
 * In-Memory Sliding Window Rate Limiter
 */
export class SlidingWindowRateLimiter {
  private requests = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  isAllowed(ip: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const timestamps = (this.requests.get(ip) || []).filter(t => now - t < this.windowMs);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] || now;
      const retryAfterSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    timestamps.push(now);
    this.requests.set(ip, timestamps);
    return { allowed: true, remaining: this.maxRequests - timestamps.length, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.requests.clear();
  }
}

export function createGatewayServer(customConfig?: Partial<GatewayConfig>): {
  server: http.Server;
  healthChecker: HealthChecker;
  rateLimiter: SlidingWindowRateLimiter;
} {
  const env = validateEnv(BaseEnvSchema);
  const config: GatewayConfig = {
    port: customConfig?.port ?? (env.PORT || 4000),
    jwtSecret: customConfig?.jwtSecret ?? env.JWT_SECRET,
    internalApiKey: customConfig?.internalApiKey ?? env.INTERNAL_SERVICE_API_KEY,
    logLevel: customConfig?.logLevel ?? env.LOG_LEVEL,
    requestTimeoutMs: customConfig?.requestTimeoutMs ?? 10000,
    maxBodySizeBytes: customConfig?.maxBodySizeBytes ?? 1048576, // 1MB limit
    rateLimitWindowMs: customConfig?.rateLimitWindowMs ?? 60000,
    rateLimitMaxRequests: customConfig?.rateLimitMaxRequests ?? 100,
    routes: customConfig?.routes ?? [
      { prefix: "/api/v1/identity", targetHost: "localhost", targetPort: 4001, rewritePrefix: "/v1/identity", requireAuth: false },
      { prefix: "/api/v1/users", targetHost: "localhost", targetPort: 4002, rewritePrefix: "/v1/users", requireAuth: true },
      { prefix: "/api/v1/consents", targetHost: "localhost", targetPort: 4002, rewritePrefix: "/v1/consents", requireAuth: true },
      { prefix: "/api/v1/authorisations", targetHost: "localhost", targetPort: 4002, rewritePrefix: "/v1/authorisations", requireAuth: true },
      { prefix: "/api/v1/sources", targetHost: "localhost", targetPort: 4003, rewritePrefix: "/v1/sources", requireAuth: false },
      { prefix: "/api/v1/scans", targetHost: "localhost", targetPort: 4004, rewritePrefix: "/v1/scans", requireAuth: true },
      { prefix: "/api/v1/cases", targetHost: "localhost", targetPort: 4005, rewritePrefix: "/v1/cases", requireAuth: true },
      { prefix: "/api/v1/removals", targetHost: "localhost", targetPort: 4006, rewritePrefix: "/v1/removals", requireAuth: true },
      { prefix: "/api/v1/verification", targetHost: "localhost", targetPort: 4007, rewritePrefix: "/v1/verifications", requireAuth: true },
      { prefix: "/api/v1/verifications", targetHost: "localhost", targetPort: 4007, rewritePrefix: "/v1/verifications", requireAuth: true }
    ]
  };

  const logger = createLogger("api-gateway", config.logLevel);
  const healthChecker = new HealthChecker("api-gateway");
  const rateLimiter = new SlidingWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);

  healthChecker.registerComponentCheck("gateway_router", async () => ({
    status: "UP",
    message: "API Gateway routing mesh operational"
  }));

  const server = http.createServer(async (req, res) => {
    const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    const startTime = Date.now();
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";

    // 1. Strict Security Headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Correlation-Id", correlationId);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Correlation-Id");

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Helper: Structured JSON Response
    const sendJson = (statusCode: number, payload: unknown, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(statusCode, { "Content-Type": "application/json", ...extraHeaders });
      res.end(JSON.stringify(payload));
    };

    // Helper: Error Envelope
    const sendError = (statusCode: number, code: string, message: string, extraHeaders: Record<string, string> = {}) => {
      sendJson(
        statusCode,
        {
          success: false,
          error: { code, message },
          requestId: correlationId
        },
        extraHeaders
      );
    };

    // 2. Liveness & Readiness Probes
    if (url.pathname === "/health") {
      const health = healthChecker.executeLiveness();
      sendJson(200, health);
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      sendJson(ready.status === "DOWN" ? 503 : 200, ready);
      return;
    }

    // 3. Rate Limiting Check
    const rateCheck = rateLimiter.isAllowed(clientIp);
    res.setHeader("X-RateLimit-Limit", config.rateLimitMaxRequests!.toString());
    res.setHeader("X-RateLimit-Remaining", rateCheck.remaining.toString());

    if (!rateCheck.allowed) {
      sendError(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please retry in a few moments.", {
        "Retry-After": rateCheck.retryAfterSeconds.toString()
      });
      return;
    }

    // 4. Request Size Limit Check
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > config.maxBodySizeBytes!) {
      sendError(413, "PAYLOAD_TOO_LARGE", `Request payload exceeds ${config.maxBodySizeBytes} byte limit.`);
      return;
    }

    // 5. Gateway Root Route & Catalog
    if (url.pathname === "/" || url.pathname === "/api/v1") {
      sendJson(200, {
        success: true,
        data: {
          name: "NIJAKAVACH API Gateway",
          version: "v1",
          status: "OPERATIONAL",
          endpoints: {
            identity: "/api/v1/identity",
            users: "/api/v1/users",
            sources: "/api/v1/sources",
            scans: "/api/v1/scans",
            cases: "/api/v1/cases",
            removals: "/api/v1/removals",
            verification: "/api/v1/verification"
          }
        },
        requestId: correlationId
      });
      return;
    }

    // 6. Match Route Target
    const matchedRoute = config.routes!.find(r => url.pathname.startsWith(r.prefix));

    if (!matchedRoute) {
      sendError(404, "ROUTE_NOT_FOUND", `Endpoint ${url.pathname} is not registered on this gateway.`);
      return;
    }

    // 7. Authentication Enforcement
    let verifiedIdentity: { userId: string; email: string; roles: string[] } | null = null;
    const isPublicAuthException =
      url.pathname === "/api/v1/identity/register" ||
      url.pathname === "/api/v1/identity/login" ||
      (url.pathname.startsWith("/api/v1/sources") && req.method === "GET");

    if (matchedRoute.requireAuth && !isPublicAuthException) {
      verifiedIdentity = authenticateBearerToken(req.headers.authorization, config.jwtSecret);
      if (!verifiedIdentity) {
        sendError(401, "UNAUTHORIZED", "Valid Bearer authentication token required.");
        return;
      }
    }

    // 8. Reverse Proxy to Downstream Microservice
    const targetPath = url.pathname.replace(matchedRoute.prefix, matchedRoute.rewritePrefix) + url.search;

    // Sanitize headers: strip internal identity headers coming from external client to prevent spoofing
    const downstreamHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    delete downstreamHeaders["host"];
    delete downstreamHeaders["connection"];
    delete downstreamHeaders["x-user-id"];
    delete downstreamHeaders["x-user-roles"];
    delete downstreamHeaders["x-internal-service-key"];

    // Inject trusted internal identity and correlation headers
    downstreamHeaders["x-correlation-id"] = correlationId;
    downstreamHeaders["x-internal-service-key"] = config.internalApiKey;
    if (verifiedIdentity) {
      downstreamHeaders["x-user-id"] = verifiedIdentity.userId;
      downstreamHeaders["x-user-roles"] = verifiedIdentity.roles.join(",");
    }

    let isAborted = false;
    let bytesReceived = 0;

    const proxyReq = http.request(
      {
        hostname: matchedRoute.targetHost,
        port: matchedRoute.targetPort,
        path: targetPath,
        method: req.method,
        headers: downstreamHeaders,
        timeout: config.requestTimeoutMs
      },
      proxyRes => {
        if (isAborted) return;
        res.writeHead(proxyRes.statusCode || 500, {
          ...proxyRes.headers,
          "x-correlation-id": correlationId
        });
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("timeout", () => {
      isAborted = true;
      proxyReq.destroy();
      if (!res.headersSent) {
        sendError(504, "GATEWAY_TIMEOUT", "Downstream service timed out.");
      }
    });

    proxyReq.on("error", err => {
      if (isAborted) return;
      logger.error(`Proxy forwarding error to ${matchedRoute.targetHost}:${matchedRoute.targetPort}: ${err.message}`, {
        correlationId
      });
      if (!res.headersSent) {
        sendError(502, "BAD_GATEWAY", "Downstream service unavailable.");
      }
    });

    // Stream incoming request body with strict size counter
    req.on("data", chunk => {
      bytesReceived += chunk.length;
      if (bytesReceived > config.maxBodySizeBytes!) {
        isAborted = true;
        req.destroy();
        proxyReq.destroy();
        if (!res.headersSent) {
          sendError(413, "PAYLOAD_TOO_LARGE", `Request payload exceeds ${config.maxBodySizeBytes} byte limit.`);
        }
        return;
      }
      proxyReq.write(chunk);
    });

    req.on("end", () => {
      if (!isAborted) {
        proxyReq.end();
      }
    });

    res.on("finish", () => {
      logger.info(`Request processed: ${req.method} ${url.pathname}`, {
        correlationId,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime
      });
    });
  });

  return { server, healthChecker, rateLimiter };
}

// Start standalone server when executed directly
if (require.main === module) {
  const env = validateEnv(BaseEnvSchema);
  const logger = createLogger("api-gateway", env.LOG_LEVEL);
  const { server } = createGatewayServer();
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
}
