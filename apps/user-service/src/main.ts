import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { RegisterIdentifierRequestSchema, GrantConsentRequestSchema } from "@nijakavach/contracts";
import {
  normalizeE164Phone,
  generateHmacFingerprint,
  encryptAes256Gcm,
  maskPhoneNumber,
  maskEmail
} from "@nijakavach/security";
import { IdentifierType } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
const logger = createLogger("user-service", env.LOG_LEVEL);
const healthChecker = new HealthChecker("user-service");

// In-memory demo registry representing user_consent schema
const identifiers = new Map<string, Array<{
  id: string;
  type: IdentifierType;
  hmacFingerprint: string;
  maskedValue: string;
  encryptedValue: string;
  createdAt: string;
}>>();

const consents = new Map<string, Array<{
  id: string;
  purpose: string;
  statutoryBasis: string;
  grantedAt: string;
  active: boolean;
}>>();

healthChecker.registerComponentCheck("user_consent_db_schema", async () => ({
  status: "UP",
  message: "Schema 'user_consent' reachable"
}));

const server = http.createServer(async (req, res) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
  const userId = (req.headers["x-user-id"] as string) || "usr-default-demo";
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Correlation-Id", correlationId);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    const health = await healthChecker.execute();
    res.writeHead(health.status === "DOWN" ? 503 : 200);
    res.end(JSON.stringify(health));
    return;
  }

  const parseBody = async (): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (err) { reject(err); }
      });
    });
  };

  // Register Identifier (e.g. Phone Number or Email)
  if (req.method === "POST" && url.pathname === "/v1/users/identifiers") {
    try {
      const raw = await parseBody();
      const body = RegisterIdentifierRequestSchema.parse(raw);

      let normalizedValue: string;
      let masked: string;

      if (body.type === IdentifierType.PHONE_NUMBER) {
        normalizedValue = normalizeE164Phone(body.value);
        masked = maskPhoneNumber(normalizedValue);
      } else {
        normalizedValue = body.value.toLowerCase().trim();
        masked = maskEmail(normalizedValue);
      }

      const hmacFingerprint = generateHmacFingerprint(normalizedValue, env.HMAC_PEPPER_SECRET);
      const encrypted = encryptAes256Gcm(normalizedValue, env.AES_256_GCM_ENCRYPTION_KEY);

      const id = crypto.randomUUID();
      const record = {
        id,
        type: body.type,
        hmacFingerprint,
        maskedValue: masked,
        encryptedValue: JSON.stringify(encrypted),
        createdAt: new Date().toISOString()
      };

      const userList = identifiers.get(userId) || [];
      userList.push(record);
      identifiers.set(userId, userList);

      logger.info("Identifier registered with cryptographic HMAC fingerprint", {
        correlationId,
        userId,
        identifierId: id,
        type: body.type,
        masked
      });

      res.writeHead(201);
      res.end(JSON.stringify({
        success: true,
        data: {
          id: record.id,
          type: record.type,
          maskedValue: record.maskedValue,
          hmacFingerprint: record.hmacFingerprint,
          createdAt: record.createdAt
        }
      }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  // List Identifiers
  if (req.method === "GET" && url.pathname === "/v1/users/identifiers") {
    const list = identifiers.get(userId) || [];
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      data: list.map(item => ({
        id: item.id,
        type: item.type,
        maskedValue: item.maskedValue,
        hmacFingerprint: item.hmacFingerprint,
        createdAt: item.createdAt
      }))
    }));
    return;
  }

  // Grant DPDP Consent
  if (req.method === "POST" && url.pathname === "/v1/users/consent") {
    try {
      const raw = await parseBody();
      const body = GrantConsentRequestSchema.parse(raw);

      const consentRecord = {
        id: crypto.randomUUID(),
        purpose: body.purpose,
        statutoryBasis: body.statutoryBasis,
        grantedAt: new Date().toISOString(),
        active: true
      };

      const userConsents = consents.get(userId) || [];
      userConsents.push(consentRecord);
      consents.set(userId, userConsents);

      logger.info("DPDP explicit consent granted", {
        correlationId,
        userId,
        purpose: body.purpose
      });

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, data: consentRecord }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }));
});

const PORT = 4002;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH User & Consent Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
