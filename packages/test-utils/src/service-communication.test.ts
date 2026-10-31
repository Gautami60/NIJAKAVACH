import { test, describe } from "node:test";
import * as assert from "node:assert";
import {
  InMemoryEventBus,
  OutboxDispatcher,
  createCloudEvent,
  createOutboxMessage,
  calculateBackoffWithJitter,
  IdempotencyTracker,
  OutboxMessage
} from "@nijakavach/event-contracts";
import { validateInternalServiceKey } from "@nijakavach/security";
import { HealthChecker } from "@nijakavach/observability";

describe("Service Communication & Event Mesh Tests", () => {
  // ==============================================================================
  // 1. CLOUDEVENTS V1.0 ENVELOPE INTEGRITY
  // ==============================================================================
  test("1. CloudEvents v1.0 standard envelope conformance", () => {
    const payload = {
      scanId: "sc-111",
      matchesFound: 3,
      sourceId: "src-222"
    };

    const event = createCloudEvent(
      "discovery.scan.completed",
      "urn:nijakavach:service:discovery",
      "corr-999-test",
      payload
    );

    assert.strictEqual(event.specversion, "1.0");
    assert.strictEqual(event.type, "discovery.scan.completed");
    assert.strictEqual(event.source, "urn:nijakavach:service:discovery");
    assert.strictEqual(event.correlationid, "corr-999-test");
    assert.strictEqual(event.datacontenttype, "application/json");
    assert.ok(event.id);
    assert.ok(event.time);
    assert.deepStrictEqual(event.data, payload);
  });

  // ==============================================================================
  // 2. IN-MEMORY EVENT BUS PUBLISH & SUBSCRIBE
  // ==============================================================================
  test("2. Event bus delivers messages to subscribers and supports unsubscription", async () => {
    const bus = new InMemoryEventBus();
    const received: any[] = [];

    const unsubscribe = bus.subscribe<{ testId: string }>("identity.user.registered", async (evt) => {
      received.push(evt);
    });

    await bus.publish("identity.user.registered", { testId: "u-1" }, "corr-sub-1");
    await bus.publish("identity.user.registered", { testId: "u-2" }, "corr-sub-2");

    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].data.testId, "u-1");
    assert.strictEqual(received[1].data.testId, "u-2");

    // Unsubscribe
    unsubscribe();
    await bus.publish("identity.user.registered", { testId: "u-3" }, "corr-sub-3");
    assert.strictEqual(received.length, 2, "Unsubscribed handler must not receive future events");
  });

  // ==============================================================================
  // 3. TRANSACTIONAL OUTBOX MESSAGE GENERATION & DISPATCH
  // ==============================================================================
  test("3. Transactional outbox records are dispatched and transitioned to DISPATCHED", async () => {
    const bus = new InMemoryEventBus();
    const dispatcher = new OutboxDispatcher(bus, 3);

    const publishedEvents: any[] = [];
    bus.subscribe("case.match.confirmed", async (evt) => {
      publishedEvents.push(evt);
    });

    const pendingRecord: OutboxMessage<{ caseId: string; userId: string }> = createOutboxMessage(
      "cases",
      "c-123",
      "case.match.confirmed",
      { caseId: "c-123", userId: "u-456" },
      "corr-outbox-1"
    );

    assert.strictEqual(pendingRecord.status, "PENDING");
    assert.strictEqual(pendingRecord.retryCount, 0);

    await dispatcher.dispatch(pendingRecord);

    assert.strictEqual(pendingRecord.status, "DISPATCHED");
    assert.ok(pendingRecord.dispatchedAt);
    assert.strictEqual(publishedEvents.length, 1);
    assert.strictEqual(publishedEvents[0].data.caseId, "c-123");
  });

  test("4. Outbox dispatcher retries failed dispatches and marks FAILED when exhausted", async () => {
    // Publisher that always fails
    const failingPublisher = {
      publish: async () => {
        throw new Error("Broker connection refused");
      },
      enqueueJob: async () => {}
    };

    const dispatcher = new OutboxDispatcher(failingPublisher, 2);

    const record = createOutboxMessage(
      "removals",
      "r-999",
      "removal.optout.requested",
      { removalId: "r-999" },
      "corr-fail-1"
    );

    // Attempt 1
    const r1 = await dispatcher.dispatch(record);
    assert.strictEqual(r1.status, "PENDING");
    assert.strictEqual(record.status, "PENDING");
    assert.strictEqual(record.retryCount, 1);

    // Attempt 2 (exhausts maxRetries = 2)
    const r2 = await dispatcher.dispatch(record);
    assert.strictEqual(r2.status, "FAILED");
    assert.strictEqual(record.status, "FAILED");
    assert.strictEqual(record.retryCount, 2);
  });

  // ==============================================================================
  // 4. EXPONENTIAL BACKOFF WITH FULL JITTER FORMULA
  // ==============================================================================
  test("5. Exponential backoff with full jitter stays within expected bounds", () => {
    const baseMs = 100;
    const maxMs = 5000;

    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = calculateBackoffWithJitter(attempt, baseMs, maxMs);
      const theoreticalMax = Math.min(maxMs, baseMs * Math.pow(2, attempt));

      assert.ok(delay >= 0, `Delay ${delay} must be >= 0`);
      assert.ok(delay <= theoreticalMax, `Delay ${delay} must be <= theoreticalMax ${theoreticalMax}`);
    }

    // Check jitter distribution: multiple calls on same attempt must not produce identical values
    const samples = Array.from({ length: 20 }, () => calculateBackoffWithJitter(4, 100, 5000));
    const uniqueSamples = new Set(samples);
    assert.ok(uniqueSamples.size > 1, "Jitter must produce non-deterministic randomized delays");
  });

  // ==============================================================================
  // 5. IDEMPOTENCY TRACKER INVARIANTS
  // ==============================================================================
  test("6. IdempotencyTracker marks, checks, and respects TTL", async () => {
    const tracker = new IdempotencyTracker();

    assert.strictEqual(tracker.has("idem-key-1"), false);
    assert.strictEqual(tracker.mark("idem-key-1", 50), true); // 50ms TTL
    assert.strictEqual(tracker.has("idem-key-1"), true);
    assert.strictEqual(tracker.mark("idem-key-1", 50), false, "Duplicate mark must return false");

    // Wait for TTL expiration
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(tracker.has("idem-key-1"), false, "Expired key must be cleared");
  });

  // ==============================================================================
  // 6. INTERNAL SERVICE KEY VALIDATION (TIMING-SAFE)
  // ==============================================================================
  test("7. Constant-time internal service key validation resists tampering", () => {
    const secret = "super-secret-service-mesh-key-987654321";

    assert.strictEqual(validateInternalServiceKey(secret, secret), true);
    assert.strictEqual(validateInternalServiceKey("wrong-key-same-length!", secret), false);
    assert.strictEqual(validateInternalServiceKey("short", secret), false);
    assert.strictEqual(validateInternalServiceKey(undefined, secret), false);
    assert.strictEqual(validateInternalServiceKey("", secret), false);
  });

  // ==============================================================================
  // 7. OBSERVABILITY HEALTH CHECK LIFECYCLE
  // ==============================================================================
  test("8. HealthChecker distinguishes liveness from readiness probes", async () => {
    const checker = new HealthChecker("test-service");

    // Liveness is immediate and UP
    const live = checker.executeLiveness();
    assert.strictEqual(live.status, "UP");
    assert.strictEqual(live.service, "test-service");

    // Register passing check
    checker.registerComponentCheck("db_connection", async () => ({
      status: "UP",
      message: "PostgreSQL schema reachable"
    }));

    const readyPass = await checker.executeReadiness();
    assert.strictEqual(readyPass.status, "UP");
    assert.strictEqual(readyPass.components["db_connection"]?.status, "UP");

    // Register failing critical component check
    checker.registerComponentCheck(
      "broker_channel",
      async () => ({
        status: "DOWN",
        message: "RabbitMQ cluster unreachable"
      }),
      { critical: true }
    );

    const readyFail = await checker.executeReadiness();
    assert.strictEqual(readyFail.status, "DOWN", "Failing critical component must mark readiness DOWN");
    assert.strictEqual(readyFail.components["broker_channel"]?.status, "DOWN");

    // Process liveness remains UP even if external dependencies are down
    const liveStillUp = checker.executeLiveness();
    assert.strictEqual(liveStillUp.status, "UP");
  });
});
