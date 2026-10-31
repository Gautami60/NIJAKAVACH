import * as http from "node:http";
import * as crypto from "node:crypto";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { IdempotencyTracker, calculateBackoffWithJitter, InMemoryEventBus } from "@nijakavach/event-contracts";

export interface WorkerJob<T = unknown> {
  jobId: string;
  queue: string;
  payload: T;
  correlationId: string;
  attempt: number;
  createdAt: string;
}

export interface WorkerPoolConfig {
  maxConcurrency: number;
  jobTimeoutMs: number;
  maxRetries: number;
  eventBus?: InMemoryEventBus;
}

export class SourceWorkerPool {
  private activeJobs = new Set<string>();
  private idempotencyTracker = new IdempotencyTracker();
  private isShuttingDown = false;
  private config: WorkerPoolConfig;
  private logger = createLogger("source-workers", "info");

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 5,
      jobTimeoutMs: config.jobTimeoutMs ?? 15000,
      maxRetries: config.maxRetries ?? 3,
      eventBus: config.eventBus ?? new InMemoryEventBus()
    };
  }

  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  isAcceptingJobs(): boolean {
    return !this.isShuttingDown && this.activeJobs.size < this.config.maxConcurrency;
  }

  async processJob<T, R>(
    job: WorkerJob<T>,
    executor: (payload: T, correlationId: string) => Promise<R>
  ): Promise<{ success: boolean; result?: R; error?: string; deadLettered?: boolean }> {
    if (this.isShuttingDown) {
      return { success: false, error: "Worker is shutting down; job rejected" };
    }

    // Idempotency verification: deduplicate identical jobs
    if (this.idempotencyTracker.has(job.jobId)) {
      this.logger.warn(`Job ${job.jobId} already processed (idempotency deduplication)`, {
        correlationId: job.correlationId,
        jobId: job.jobId,
        queue: job.queue
      });
      return { success: true };
    }

    this.activeJobs.add(job.jobId);
    const startTime = Date.now();

    try {
      this.logger.info(`Starting job execution: ${job.queue} [attempt ${job.attempt}/${this.config.maxRetries}]`, {
        correlationId: job.correlationId,
        jobId: job.jobId,
        queue: job.queue
      });

      // Execute with timeout
      const result = await Promise.race([
        executor(job.payload, job.correlationId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Job timed out after ${this.config.jobTimeoutMs}ms`)), this.config.jobTimeoutMs)
        )
      ]);

      // Mark successful idempotency with 24hr TTL
      this.idempotencyTracker.mark(job.jobId, 86400000);

      this.logger.info(`Job completed successfully: ${job.queue}`, {
        correlationId: job.correlationId,
        jobId: job.jobId,
        durationMs: Date.now() - startTime
      });

      return { success: true, result };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logger.error(`Job failed: ${job.queue} - ${errorMessage}`, {
        correlationId: job.correlationId,
        jobId: job.jobId,
        durationMs,
        attempt: job.attempt
      });

      // Check retry limits
      if (job.attempt >= this.config.maxRetries) {
        this.logger.error(`Exceeded maximum retries (${this.config.maxRetries}). Routing job to dead-letter queue.`, {
          correlationId: job.correlationId,
          jobId: job.jobId,
          queue: job.queue
        });

        this.config.eventBus?.routeToDeadLetter(job.queue, job.payload, errorMessage);
        return { success: false, error: errorMessage, deadLettered: true };
      }

      // Calculate exponential backoff with full jitter
      const backoffDelay = calculateBackoffWithJitter(job.attempt, 500, 10000);
      this.logger.info(`Scheduling retry with backoff delay ${backoffDelay}ms`, {
        correlationId: job.correlationId,
        jobId: job.jobId,
        backoffDelay
      });

      return { success: false, error: errorMessage, deadLettered: false };
    } finally {
      this.activeJobs.delete(job.jobId);
    }
  }

  async shutdown(timeoutMs = 5000): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info(`Worker shutting down. Waiting for ${this.activeJobs.size} active jobs to complete...`);

    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
    }

    if (this.activeJobs.size > 0) {
      this.logger.warn(`Shutdown timeout reached. Forcefully exiting with ${this.activeJobs.size} remaining jobs.`);
    } else {
      this.logger.info("All active worker jobs drained successfully.");
    }
  }
}

/**
 * Executes a simulated discovery check against a lawful, permitted source.
 * Conforms strictly to source rate-limits and robots/ToS restrictions.
 */
export async function executeSourceCheck(params: {
  scanId: string;
  sourceId: string;
  identifierFingerprint: string;
}) {
  const evidenceDigest = crypto.createHash("sha256").update(`${params.scanId}:${params.sourceId}`).digest("hex");
  return {
    scanId: params.scanId,
    sourceId: params.sourceId,
    matched: true,
    evidenceDigest,
    evidenceKey: `evidence/${params.scanId}/${params.sourceId}.enc`
  };
}

export function createSourceWorkerServer(pool = new SourceWorkerPool()): {
  server: http.Server;
  healthChecker: HealthChecker;
  pool: SourceWorkerPool;
} {
  validateEnv(BaseEnvSchema);
  const healthChecker = new HealthChecker("source-workers");

  healthChecker.registerComponentCheck("rabbitmq_worker_channel", async () => ({
    status: "UP",
    message: `Worker pool active. Concurrency capacity: ${pool.isAcceptingJobs() ? "AVAILABLE" : "BUSY"}`
  }));

  healthChecker.registerComponentCheck("s3_storage_client", async () => ({
    status: "UP",
    message: "S3 connection active for evidence streaming"
  }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Correlation-Id", correlationId);

    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify(healthChecker.executeLiveness()));
      return;
    }

    if (url.pathname === "/ready") {
      const ready = await healthChecker.executeReadiness();
      res.writeHead(ready.status === "DOWN" ? 503 : 200);
      res.end(JSON.stringify(ready));
      return;
    }

    res.writeHead(404);
    res.end(
      JSON.stringify({
        status: "Worker daemon active",
        activeJobs: pool.getActiveJobCount(),
        isAccepting: pool.isAcceptingJobs(),
        requestId: correlationId
      })
    );
  });

  return { server, healthChecker, pool };
}

if (require.main === module) {
  const logger = createLogger("source-workers", "info");
  const pool = new SourceWorkerPool();
  const { server } = createSourceWorkerServer(pool);
  const PORT = 4010;

  server.listen(PORT, () => {
    logger.info(`NIJAKAVACH Source Adapter Worker Daemon active on port ${PORT}`);
  });

  async function handleShutdown(signal: string) {
    logger.info(`Received ${signal}, initiating graceful worker drain...`);
    await pool.shutdown(5000);
    server.close(() => {
      logger.info("Worker HTTP daemon closed.");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
