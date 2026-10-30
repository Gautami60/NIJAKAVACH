import * as crypto from "node:crypto";
import jwt, { SignOptions } from "jsonwebtoken";

/**
 * Normalizes phone numbers to standard E.164 international format.
 * Strips whitespace, hyphens, parentheses, and leading zeros.
 * Defaults to +91 (India) if standard 10-digit number is provided.
 */
export function normalizeE164Phone(raw: string, defaultCountry = "+91"): string {
  let digits = raw.replace(/\D/g, "");
  if (!digits) {
    throw new Error("Invalid phone number: empty digits");
  }

  // Strip leading trunk zero (e.g. 09876543210 -> 9876543210)
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (raw.trim().startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `${defaultCountry}${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Generates a deterministic keyed HMAC-SHA256 fingerprint for indexing and lookups.
 * Prevents dictionary attacks and rainbow tables on finite phone number keyspace.
 */
export function generateHmacFingerprint(value: string, pepperSecret: string): string {
  if (!pepperSecret || pepperSecret.length < 32) {
    throw new Error("Pepper secret must be at least 32 characters long");
  }
  return crypto.createHmac("sha256", pepperSecret).update(value).digest("hex");
}

/**
 * Authenticated Envelope Encryption (AES-256-GCM)
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptAes256Gcm(plainText: string, keyHex: string): EncryptedPayload {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
  }

  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex")
  };
}

export function decryptAes256Gcm(
  ciphertextHex: string,
  ivHex: string,
  tagHex: string,
  keyHex: string
): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

/**
 * Display Masking for Phone Numbers (e.g. +91 98**** *210)
 */
export function maskPhoneNumber(phone: string): string {
  const clean = phone.trim();
  if (clean.length < 8) return "******";
  const start = clean.slice(0, 5);
  const end = clean.slice(-3);
  return `${start}*****${end}`;
}

/**
 * Display Masking for Emails (e.g. j***e@example.com)
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "****@****";
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/**
 * Password Hashing via Scrypt with Salt (Node.js native cryptographic standard)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      const keyBuffer = Buffer.from(key, "hex");
      resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
    });
  });
}

/**
 * JWT Token Generation & Verification
 */
export interface TokenPayload {
  sub: string;
  email: string;
  roles: string[];
  [key: string]: unknown;
}

export function generateJwt(payload: TokenPayload, secret: string, expiresInSeconds = 900): string {
  const options: SignOptions = {
    expiresIn: expiresInSeconds,
    issuer: "nijakavach-platform"
  };
  return jwt.sign(payload, secret, options);
}

export function verifyJwt<T extends TokenPayload>(token: string, secret: string): T {
  return jwt.verify(token, secret, {
    issuer: "nijakavach-platform"
  }) as T;
}
