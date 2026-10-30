import { test } from "node:test";
import * as assert from "node:assert";
import {
  normalizeE164Phone,
  generateHmacFingerprint,
  encryptAes256Gcm,
  decryptAes256Gcm,
  maskPhoneNumber,
  maskEmail,
  hashPassword,
  verifyPassword,
  generateJwt,
  verifyJwt
} from "./index";

test("E.164 phone normalization formats Indian 10-digit numbers", () => {
  assert.strictEqual(normalizeE164Phone("9876543210"), "+919876543210");
  assert.strictEqual(normalizeE164Phone("+91 98765-43210"), "+919876543210");
  assert.strictEqual(normalizeE164Phone("09876543210"), "+919876543210");
});

test("Keyed HMAC fingerprint produces deterministic 64-char hex digest", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const phone = "+919876543210";
  const digest1 = generateHmacFingerprint(phone, secret);
  const digest2 = generateHmacFingerprint(phone, secret);

  assert.strictEqual(digest1.length, 64);
  assert.strictEqual(digest1, digest2);
});

test("AES-256-GCM authenticated envelope encryption and decryption roundtrip", () => {
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const plainText = "+919876543210";

  const encrypted = encryptAes256Gcm(plainText, key);
  assert.notStrictEqual(encrypted.ciphertext, plainText);

  const decrypted = decryptAes256Gcm(encrypted.ciphertext, encrypted.iv, encrypted.tag, key);
  assert.strictEqual(decrypted, plainText);
});

test("Display masking hides PII characters properly", () => {
  assert.strictEqual(maskPhoneNumber("+919876543210"), "+9198*****210");
  assert.strictEqual(maskEmail("priya.sharma@example.com"), "p***a@example.com");
});

test("Password hashing with scrypt verifies correctly", async () => {
  const password = "SuperSecretSecurePassword123!";
  const hash = await hashPassword(password);

  assert.strictEqual(await verifyPassword(password, hash), true);
  assert.strictEqual(await verifyPassword("WrongPassword", hash), false);
});

test("JWT issuance and verification lifecycle", () => {
  const secret = "test_jwt_secret_at_least_32_characters_long";
  const token = generateJwt({ sub: "usr-123", email: "test@example.in", roles: ["USER"] }, secret);

  const verified = verifyJwt(token, secret);
  assert.strictEqual(verified.sub, "usr-123");
  assert.strictEqual(verified.email, "test@example.in");
});
