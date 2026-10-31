import { test, describe, before, after } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import { createIdentityServer } from "./main";

describe("Identity Service Implementation Tests", () => {
  let server: http.Server;
  let serverPort: number;
  let devEmailAdapter: any;
  const internalApiKey = "test-internal-service-key-1234567890!";
  const headers = {
    "content-type": "application/json",
    "x-internal-service-key": internalApiKey
  };

  before(async () => {
    const instance = createIdentityServer({
      internalApiKey,
      jwtSecret: "test-jwt-secret-key-minimum-32-bytes-long!"
    });
    server = instance.server;
    devEmailAdapter = instance.devEmailAdapter;

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // 1. REGISTRATION
  // =========================================================================
  test("1. User registration succeeds with Scrypt hashing and sends verification email", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "Aarav.Sharma@example.in", // Tests normalization
        password: "SuperSecretPassword123!",
        fullName: "Aarav Sharma"
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
    assert.ok(body.data.refreshToken);
    assert.strictEqual(body.data.user.email, "aarav.sharma@example.in", "Email must be normalized to lowercase");
    assert.strictEqual(body.data.user.emailVerified, false);
    assert.strictEqual((body.data.user as any).passwordHash, undefined, "Password hash must never leak in API");

    // Dev email adapter should have received verification token
    const token = devEmailAdapter.getLatestTokenFor("aarav.sharma@example.in", "EMAIL_VERIFICATION");
    assert.ok(token, "Verification token must be generated and dispatched to email adapter");
  });

  test("2. Duplicate registration returns 409 without creating second account", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "AnotherPassword123!",
        fullName: "Aarav Sharma Duplicate"
      })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json() as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "EMAIL_EXISTS");
  });

  // =========================================================================
  // 2. EMAIL VERIFICATION
  // =========================================================================
  test("3. Email verification consumes token, updates account, and rejects reuse", async () => {
    const token = devEmailAdapter.getLatestTokenFor("aarav.sharma@example.in", "EMAIL_VERIFICATION");
    assert.ok(token);

    // First consumption: success
    const res1 = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/verify-email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token })
    });

    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json() as any;
    assert.strictEqual(body1.success, true);
    assert.ok(body1.data.verifiedAt);

    // Second consumption: rejected (prevent token reuse)
    const res2 = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/verify-email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token })
    });

    assert.strictEqual(res2.status, 400);
    const body2 = await res2.json() as any;
    assert.strictEqual(body2.error.code, "TOKEN_ALREADY_USED");
  });

  test("4. Invalid email verification token is rejected safely", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/verify-email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "non-existent-fake-token-12345678" })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "INVALID_TOKEN");
  });

  // =========================================================================
  // 3. LOGIN & AUTHENTICATION
  // =========================================================================
  test("5. Login succeeds with correct credentials and returns session tokens", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "SuperSecretPassword123!"
      })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
    assert.ok(body.data.refreshToken);
    assert.strictEqual(body.data.user.emailVerified, true);
  });

  test("6. Login fails with incorrect password without revealing account details", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "WrongPassword999!"
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "INVALID_CREDENTIALS");
  });

  test("7. Login fails with non-existent email returning identical error envelope", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "ghost.user@nonexistent.in",
        password: "SomePassword123!"
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "INVALID_CREDENTIALS");
  });

  // =========================================================================
  // 4. REFRESH TOKEN ROTATION & REVOCATION
  // =========================================================================
  test("8. Refresh token rotates cleanly and invalidates previous refresh token", async () => {
    // 1. Login to get fresh tokens
    const loginRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "SuperSecretPassword123!"
      })
    });
    const loginBody = await loginRes.json() as any;
    const oldRefreshToken = loginBody.data.refreshToken;

    // 2. Refresh token rotation
    const refreshRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/refresh-token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken: oldRefreshToken })
    });

    assert.strictEqual(refreshRes.status, 200);
    const refreshBody = await refreshRes.json() as any;
    assert.ok(refreshBody.data.accessToken);
    assert.ok(refreshBody.data.refreshToken);
    assert.notStrictEqual(refreshBody.data.refreshToken, oldRefreshToken, "Rotated refresh token must be fresh");

    // 3. Attempt to reuse the old refresh token (must be rejected)
    const reuseRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/refresh-token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken: oldRefreshToken })
    });

    assert.strictEqual(reuseRes.status, 401);
    const reuseBody = await reuseRes.json() as any;
    assert.strictEqual(reuseBody.error.code, "TOKEN_REUSE_DETECTED");
  });

  test("9. Logout revokes active session", async () => {
    const loginRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "SuperSecretPassword123!"
      })
    });
    const loginBody = await loginRes.json() as any;
    const tokenToRevoke = loginBody.data.refreshToken;

    const logoutRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken: tokenToRevoke })
    });

    assert.strictEqual(logoutRes.status, 200);

    // Using the revoked token must fail
    const attemptRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/refresh-token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken: tokenToRevoke })
    });

    assert.strictEqual(attemptRes.status, 401);
  });

  // =========================================================================
  // 5. PASSWORD MANAGEMENT
  // =========================================================================
  test("10. Forgot password generates reset token and reset password updates credentials", async () => {
    // 1. Forgot password request
    const forgotRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/forgot-password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "aarav.sharma@example.in" })
    });

    assert.strictEqual(forgotRes.status, 200);
    const resetToken = devEmailAdapter.getLatestTokenFor("aarav.sharma@example.in", "PASSWORD_RESET");
    assert.ok(resetToken, "Reset token must be delivered to adapter");

    // 2. Consume reset token with new password
    const resetRes = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/reset-password`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        token: resetToken,
        newPassword: "BrandNewPassword2026!"
      })
    });

    assert.strictEqual(resetRes.status, 200);

    // 3. Old password should fail
    const oldLogin = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "SuperSecretPassword123!"
      })
    });
    assert.strictEqual(oldLogin.status, 401);

    // 4. New password should succeed
    const newLogin = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "BrandNewPassword2026!"
      })
    });
    assert.strictEqual(newLogin.status, 200);
  });

  test("11. Direct access without internal service key is rejected with 403", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/identity/login`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // Missing x-internal-service-key
      body: JSON.stringify({
        email: "aarav.sharma@example.in",
        password: "BrandNewPassword2026!"
      })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json() as any;
    assert.strictEqual(body.error.code, "FORBIDDEN");
  });
});
