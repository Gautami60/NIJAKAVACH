import { test, describe } from "node:test";
import * as assert from "node:assert";
import { InMemoryEventBus } from "@nijakavach/event-contracts";
import { SourceWorkerPool, createSourceWorkerServer, WorkerJob } from "./main";

describe("Source Workers Foundation Tests", () => {
  test("1. Worker pool processes a valid job to completion", async () => {
    const pool = new SourceWorkerPool({ maxConcurrency: 3, jobTimeoutMs: 1000 });

    const job: WorkerJob<{ targetPhone: string }> = {
      jobId: "job-001",
      queue: "discovery.scan.dispatched",
      payload: { targetPhone: "+919876543210" },
      attempt: 1,
      createdAt: new Date().toISOString(),
      correlationId: "corr-test-1"
    };

    let executed = false;
    const res = await pool.processJob(job, async (payload, corrId) => {
      executed = true;
      assert.strictEqual(corrId, "corr-test-1");
      return { matchesFound: 2, identifier: payload.targetPhone };
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.result, { matchesFound: 2, identifier: "+919876543210" });
    assert.strictEqual(pool.getActiveJobCount(), 0);
  });

  test("2. Idempotency deduplication suppresses duplicate job executions", async () => {
    const pool = new SourceWorkerPool({ maxConcurrency: 3 });

    const job: WorkerJob<{ action: string }> = {
      jobId: "duplicate-job-999",
      queue: "removal.dispatch",
      payload: { action: "SEND_OPT_OUT" },
      attempt: 1,
      createdAt: new Date().toISOString(),
      correlationId: "corr-idem-1"
    };

    let executionCount = 0;
    const executor = async () => {
      executionCount++;
      return "SUCCESS";
    };

    // First execution
    const r1 = await pool.processJob(job, executor);
    assert.strictEqual(r1.success, true);
    assert.strictEqual(executionCount, 1);

    // Second execution with identical jobId
    const r2 = await pool.processJob(job, executor);
    assert.strictEqual(r2.success, true);
    // Executor MUST NOT run again
    assert.strictEqual(executionCount, 1, "Idempotent job must not re-run executor");
  });

  test("3. Job timeout guard terminates hanging jobs", async () => {
    const pool = new SourceWorkerPool({
      maxConcurrency: 2,
      jobTimeoutMs: 100 // 100ms timeout
    });

    const job: WorkerJob<{ action: string }> = {
      jobId: "hanging-job-001",
      queue: "discovery.scan.dispatched",
      payload: { action: "SLOW_CRAWL" },
      attempt: 1,
      createdAt: new Date().toISOString(),
      correlationId: "corr-timeout-1"
    };

    const res = await pool.processJob(job, async () => {
      // simulate hanging work (500ms > 100ms)
      await new Promise(r => setTimeout(r, 500));
      return "DONE";
    });

    assert.strictEqual(res.success, false);
    assert.match(res.error || "", /timed out after 100ms/);
    assert.strictEqual(pool.getActiveJobCount(), 0);
  });

  test("4. Failed job under maxRetries schedules retry and avoids dead-lettering", async () => {
    const eventBus = new InMemoryEventBus();
    const pool = new SourceWorkerPool({
      maxConcurrency: 2,
      maxRetries: 3,
      eventBus
    });

    const job: WorkerJob<{ action: string }> = {
      jobId: "retryable-job-001",
      queue: "discovery.scan.dispatched",
      payload: { action: "FAIL_ONCE" },
      attempt: 1, // attempt 1 of 3
      createdAt: new Date().toISOString(),
      correlationId: "corr-retry-1"
    };

    const res = await pool.processJob(job, async () => {
      throw new Error("Temporary network glitch");
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, "Temporary network glitch");
    assert.strictEqual(res.deadLettered, false, "Should not dead-letter when attempt < maxRetries");
    assert.strictEqual(eventBus.getDeadLetterCount("discovery.scan.dispatched"), 0);
  });

  test("5. Exhausted retries routes job to dead-letter queue (*.dlx)", async () => {
    const eventBus = new InMemoryEventBus();
    const pool = new SourceWorkerPool({
      maxConcurrency: 2,
      maxRetries: 3,
      eventBus
    });

    const job: WorkerJob<{ action: string }> = {
      jobId: "exhausted-job-001",
      queue: "removal.dispatch",
      payload: { action: "PERMANENT_FAIL" },
      attempt: 3, // attempt 3 of 3 (exhausted)
      createdAt: new Date().toISOString(),
      correlationId: "corr-dlq-1"
    };

    const res = await pool.processJob(job, async () => {
      throw new Error("HTTP 400 Source rejected removal payload");
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.deadLettered, true, "Should dead-letter when attempt >= maxRetries");

    assert.strictEqual(eventBus.getDeadLetterCount("removal.dispatch"), 1);
    const dlqItems = eventBus.getDeadLetterItems("removal.dispatch");
    assert.strictEqual(dlqItems.length, 1);
    assert.strictEqual(dlqItems[0]?.reason, "HTTP 400 Source rejected removal payload");
  });

  test("6. Worker pool rejects jobs during shutdown and drains active work", async () => {
    const pool = new SourceWorkerPool({ maxConcurrency: 2 });

    // Initiate shutdown
    const shutdownPromise = pool.shutdown(500);

    const job: WorkerJob<{ action: string }> = {
      jobId: "rejected-job-001",
      queue: "discovery.scan.dispatched",
      payload: { action: "NEW_JOB" },
      attempt: 1,
      createdAt: new Date().toISOString(),
      correlationId: "corr-shut-1"
    };

    const res = await pool.processJob(job, async () => "OK");
    assert.strictEqual(res.success, false);
    assert.match(res.error || "", /shutting down/i);

    await shutdownPromise;
    assert.strictEqual(pool.isAcceptingJobs(), false);
  });

  test("7. Health probes verify worker liveness and component readiness", async () => {
    const { healthChecker, pool } = createSourceWorkerServer();

    // Liveness
    const liveness = healthChecker.executeLiveness();
    assert.strictEqual(liveness.status, "UP");
    assert.strictEqual(liveness.service, "source-workers");

    // Readiness
    const readiness = await healthChecker.executeReadiness();
    assert.strictEqual(readiness.status, "UP");
    assert.strictEqual(readiness.components["rabbitmq_worker_channel"]?.status, "UP");
    assert.strictEqual(readiness.components["s3_storage_client"]?.status, "UP");
    assert.strictEqual(pool.isAcceptingJobs(), true);
  });
});
