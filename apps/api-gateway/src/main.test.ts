import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import { generateJwt } from "@nijakavach/security";
import { createGatewayServer, SlidingWindowRateLimiter } from "./main";

describe("API Gateway Foundation Tests", () => {
  let gatewayServer: http.Server;
  let mockDownstreamServer: http.Server;
  let gatewayPort: number;
  let downstreamPort: number;
  const testSecret = "test-jwt-secret-key-minimum-32-bytes-long!";
  const internalApiKey = "test-internal-service-key-1234567890!";
  let lastDownstreamHeaders: http.IncomingHttpHeaders = {};

  before(async () => {
    // 1. Setup mock downstream service
    mockDownstreamServer = http.createServer((req, res) => {
      lastDownstreamHeaders = req.headers;
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: "Downstream response ok", path: req.url }));
    });

    await new Promise<void>((resolve) => {
      mockDownstreamServer.listen(0, "127.0.0.1", () => {
        downstreamPort = (mockDownstreamServer.address() as any).port;
        resolve();
      });
    });

    // 2. Setup Gateway with mock downstream
    const { server } = createGatewayServer({
      jwtSecret: testSecret,
      internalApiKey: internalApiKey,
      rateLimitMaxRequests: 5,
      rateLimitWindowMs: 1000,
      maxBodySizeBytes: 1024, // 1KB limit for testing
      routes: [
        {
          prefix: "/api/v1/public-test",
          targetHost: "127.0.0.1",
          targetPort: downstreamPort,
          rewritePrefix: "/v1/public-test",
          requireAuth: false
        },
        {
          prefix: "/api/v1/protected-test",
          targetHost: "127.0.0.1",
          targetPort: downstreamPort,
          rewritePrefix: "/v1/protected-test",
          requireAuth: true
        }
      ]
    });

    gatewayServer = server;

    await new Promise<void>((resolve) => {
      gatewayServer.listen(0, "127.0.0.1", () => {
        gatewayPort = (gatewayServer.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockDownstreamServer.close(() => resolve()));
  });

  test("1. Liveness probe (/health) returns 200 with service UP status", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.status, "UP");
    assert.strictEqual(body.service, "api-gateway");
    assert.ok(typeof body.uptimeSeconds === "number");
  });

  test("2. Readiness probe (/ready) returns 200 with components UP", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/ready`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.status, "UP");
    assert.strictEqual(body.service, "api-gateway");
    assert.strictEqual(body.components.gateway_router.status, "UP");
  });

  test("3. Security headers are strictly enforced on all responses", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
    assert.strictEqual(res.headers.get("content-security-policy"), "default-src 'none'");
    assert.ok(res.headers.get("x-correlation-id"));
  });

  test("4. CORS preflight OPTIONS returns 204 with allow headers", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/public-test`, {
      method: "OPTIONS"
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods") || "", /GET.*POST/);
  });

  test("5. SlidingWindowRateLimiter unit logic honors limits and resets", () => {
    const limiter = new SlidingWindowRateLimiter(60000, 3);
    const ip = "192.168.1.100";

    const r1 = limiter.isAllowed(ip);
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r1.remaining, 2);

    const r2 = limiter.isAllowed(ip);
    assert.strictEqual(r2.allowed, true);
    assert.strictEqual(r2.remaining, 1);

    const r3 = limiter.isAllowed(ip);
    assert.strictEqual(r3.allowed, true);
    assert.strictEqual(r3.remaining, 0);

    const r4 = limiter.isAllowed(ip);
    assert.strictEqual(r4.allowed, false);
    assert.strictEqual(r4.retryAfterSeconds > 0, true);

    limiter.reset();
    const r5 = limiter.isAllowed(ip);
    assert.strictEqual(r5.allowed, true);
  });

  test("6. HTTP Rate Limiting returns 429 when quota exceeded", async () => {
    // Gateway was configured with rateLimitMaxRequests = 5 for test
    const targetUrl = `http://127.0.0.1:${gatewayPort}/api/v1/public-test`;
    const headers = { "x-forwarded-for": "10.0.0.1" };

    // Fire 5 allowed requests
    for (let i = 0; i < 5; i++) {
      const res = await fetch(targetUrl, { headers });
      assert.strictEqual(res.status, 200);
    }

    // 6th request must be rejected with 429
    const blockedRes = await fetch(targetUrl, { headers });
    assert.strictEqual(blockedRes.status, 429);
    assert.ok(blockedRes.headers.get("retry-after"));
    const body = await blockedRes.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "RATE_LIMIT_EXCEEDED");
  });

  test("7. Request size limit returns 413 when body exceeds limit", async () => {
    const targetUrl = `http://127.0.0.1:${gatewayPort}/api/v1/public-test`;
    const largeBody = "x".repeat(2048); // 2KB, limit is 1KB

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-forwarded-for": "10.0.0.2"
      },
      body: largeBody
    });

    assert.strictEqual(res.status, 413);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "PAYLOAD_TOO_LARGE");
  });

  test("8. Protected route rejects missing Authorization header with 401", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/protected-test`, {
      headers: { "x-forwarded-for": "10.0.0.3" }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "UNAUTHORIZED");
  });

  test("9. Protected route rejects forged or invalid JWT with 401", async () => {
    const fakeToken = generateJwt(
      { sub: "fake-user", email: "fake@attacker.com", roles: ["USER"] },
      "wrong-secret-key-attacker"
    );

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/protected-test`, {
      headers: {
        authorization: `Bearer ${fakeToken}`,
        "x-forwarded-for": "10.0.0.4"
      }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "UNAUTHORIZED");
  });

  test("10. Protected route succeeds with valid JWT, sanitizes spoofed headers, and injects internal key", async () => {
    const validUserId = "user-uuid-12345678-real";
    const validToken = generateJwt(
      {
        sub: validUserId,
        email: "priya@nijakavach.in",
        roles: ["USER"]
      },
      testSecret
    );

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/protected-test`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        "x-user-id": "attacker-spoofed-id", // must be stripped and replaced
        "x-internal-service-key": "fake-key", // must be stripped and replaced
        "x-correlation-id": "test-client-corr-id-999",
        "x-forwarded-for": "10.0.0.5"
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);

    // Verify headers that reached the downstream service
    assert.strictEqual(lastDownstreamHeaders["x-user-id"], validUserId, "Gateway must inject authentic sub from JWT");
    assert.strictEqual(lastDownstreamHeaders["x-user-roles"], "USER");
    assert.strictEqual(lastDownstreamHeaders["x-internal-service-key"], internalApiKey, "Gateway must inject trusted internal service key");
    assert.strictEqual(lastDownstreamHeaders["x-correlation-id"], "test-client-corr-id-999");
  });

  test("11. Route not found returns structured 404 error envelope", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/unmapped-service`, {
      headers: { "x-forwarded-for": "10.0.0.6" }
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "ROUTE_NOT_FOUND");
    assert.ok(body.requestId);
  });
});
