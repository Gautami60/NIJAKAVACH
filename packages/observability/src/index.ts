import * as crypto from "node:crypto";

export type HealthStatus = "UP" | "DOWN" | "DEGRADED";

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  service: string;
  uptimeSeconds: number;
  components: Record<string, ComponentHealth>;
}

export class HealthChecker {
  private serviceName: string;
  private startTime: number;
  private checks: Map<string, () => Promise<ComponentHealth>>;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.startTime = Date.now();
    this.checks = new Map();
  }

  registerComponentCheck(name: string, checkFn: () => Promise<ComponentHealth>): void {
    this.checks.set(name, checkFn);
  }

  async execute(): Promise<HealthCheckResult> {
    const components: Record<string, ComponentHealth> = {};
    let overallStatus: HealthStatus = "UP";

    for (const [name, checkFn] of this.checks.entries()) {
      try {
        const result = await checkFn();
        components[name] = result;
        if (result.status === "DOWN") {
          overallStatus = "DOWN";
        } else if (result.status === "DEGRADED" && overallStatus !== "DOWN") {
          overallStatus = "DEGRADED";
        }
      } catch (err) {
        components[name] = {
          status: "DOWN",
          message: err instanceof Error ? err.message : "Check failed"
        };
        overallStatus = "DOWN";
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
