import * as crypto from "node:crypto";
import * as http from "node:http";

export type HealthStatus = "UP" | "DOWN" | "DEGRADED";

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
}

export interface CheckRegistration {
  checkFn: () => Promise<ComponentHealth>;
  critical: boolean;
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  service: string;
  uptimeSeconds: number;
  components: Record<string, ComponentHealth>;
}

export interface LivenessResult {
  status: "UP";
  timestamp: string;
  service: string;
  uptimeSeconds: number;
}

export class HealthChecker {
  private serviceName: string;
  private startTime: number;
  private checks: Map<string, CheckRegistration>;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.startTime = Date.now();
    this.checks = new Map();
  }

  registerComponentCheck(
    name: string,
    checkFn: () => Promise<ComponentHealth>,
    options: { critical?: boolean } = {}
  ): void {
    this.checks.set(name, {
      checkFn,
      critical: options.critical !== false
    });
  }

  /**
   * Fast liveness probe: verifies process is alive and event loop is responsive.
   */
  executeLiveness(): LivenessResult {
    return {
      status: "UP",
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  /**
   * Readiness probe: verifies critical dependencies and database schemas are reachable.
   */
  async executeReadiness(): Promise<HealthCheckResult> {
    return this.execute();
  }

  async execute(): Promise<HealthCheckResult> {
    const components: Record<string, ComponentHealth> = {};
    let overallStatus: HealthStatus = "UP";

    for (const [name, reg] of this.checks.entries()) {
      try {
        const start = Date.now();
        const result = await reg.checkFn();
        components[name] = {
          ...result,
          latencyMs: result.latencyMs ?? (Date.now() - start)
        };

        if (result.status === "DOWN" && reg.critical) {
          overallStatus = "DOWN";
        } else if (result.status === "DEGRADED" && overallStatus !== "DOWN") {
          overallStatus = "DEGRADED";
        }
      } catch (err) {
        components[name] = {
          status: "DOWN",
          message: err instanceof Error ? err.message : "Check failed"
        };
        if (reg.critical) {
          overallStatus = "DOWN";
        }
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      components
    };
  }
}

export function generateCorrelationId(): string {
  return `corr-${crypto.randomUUID()}`;
}

/**
 * Synchronous Internal HTTP Client
 * Securely communicates with other internal microservices over HTTP.
 * Injects X-Internal-Service-Key, propagates X-Correlation-Id, and enforces timeout.
 */
export interface InternalRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  userId?: string;
  userRoles?: string[];
}

export interface InternalResponse<T = unknown> {
  statusCode: number;
  data: T;
  headers: http.IncomingHttpHeaders;
}

export class InternalServiceClient {
  private internalKey: string;
  private defaultTimeoutMs: number;

  constructor(internalKey: string, defaultTimeoutMs = 5000) {
    this.internalKey = internalKey;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async request<T = unknown>(
    targetUrl: string,
    correlationId: string,
    options: InternalRequestOptions = {}
  ): Promise<InternalResponse<T>> {
    const url = new URL(targetUrl);
    const method = options.method || "GET";
    const timeout = options.timeoutMs || this.defaultTimeoutMs;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Correlation-Id": correlationId,
      "X-Internal-Service-Key": this.internalKey,
      ...(options.headers || {})
    };

    if (options.userId) {
      headers["X-User-Id"] = options.userId;
    }
    if (options.userRoles && options.userRoles.length > 0) {
      headers["X-User-Roles"] = options.userRoles.join(",");
    }

    let payload: string | undefined;
    if (options.body !== undefined) {
      payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      headers["Content-Length"] = Buffer.byteLength(payload).toString();
    }

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          timeout
        },
        res => {
          let rawData = "";
          res.on("data", chunk => {
            rawData += chunk;
          });
          res.on("end", () => {
            let parsedData: unknown;
            try {
              parsedData = rawData ? JSON.parse(rawData) : null;
            } catch {
              parsedData = rawData;
            }

            resolve({
              statusCode: res.statusCode || 500,
              data: parsedData as T,
              headers: res.headers
            });
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Internal service request to ${url.pathname} timed out after ${timeout}ms`));
      });

      req.on("error", err => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}
