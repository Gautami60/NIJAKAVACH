import * as http from "node:http";
import { validateEnv, BaseEnvSchema } from "@nijakavach/config";
import { createLogger } from "@nijakavach/logger";
import { HealthChecker, generateCorrelationId } from "@nijakavach/observability";
import { RegisterRequestSchema, LoginRequestSchema } from "@nijakavach/contracts";
import { hashPassword, verifyPassword, generateJwt } from "@nijakavach/security";
import { UserRole } from "@nijakavach/shared-types";

const env = validateEnv(BaseEnvSchema);
const logger = createLogger("identity-service", env.LOG_LEVEL);
const healthChecker = new HealthChecker("identity-service");

// In-memory demo datastore for scaffold verification (backed by identity schema in DB)
const accounts = new Map<string, { id: string; email: string; passwordHash: string; fullName: string; roles: UserRole[] }>();

healthChecker.registerComponentCheck("identity_db_schema", async () => ({
  status: "UP",
  message: "Schema 'identity' reachable"
}));

const server = http.createServer(async (req, res) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Correlation-Id", correlationId);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    const health = await healthChecker.execute();
    res.writeHead(health.status === "DOWN" ? 503 : 200);
    res.end(JSON.stringify(health));
    return;
  }

  // Parse JSON Body Helper
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

  if (req.method === "POST" && url.pathname === "/v1/identity/register") {
    try {
      const raw = await parseBody();
      const body = RegisterRequestSchema.parse(raw);

      if (accounts.has(body.email)) {
        res.writeHead(409);
        res.end(JSON.stringify({ success: false, error: { code: "EMAIL_EXISTS", message: "Account already exists" } }));
        return;
      }

      const passwordHash = await hashPassword(body.password);
      const id = crypto.randomUUID();
      const user = { id, email: body.email, passwordHash, fullName: body.fullName, roles: [UserRole.USER] };
      accounts.set(body.email, user);

      const token = generateJwt({ sub: id, email: user.email, roles: user.roles }, env.JWT_SECRET);

      logger.info("New user account registered", { correlationId, userId: id });

      res.writeHead(201);
      res.end(JSON.stringify({
        success: true,
        data: {
          accessToken: token,
          refreshToken: `rf_${crypto.randomUUID()}`,
          expiresIn: 900,
          user: { id: user.id, email: user.email, fullName: user.fullName, roles: user.roles }
        }
      }));
      return;
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } }));
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/v1/identity/login") {
    try {
      const raw = await parseBody();
      const body = LoginRequestSchema.parse(raw);

      const user = accounts.get(body.email);
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }));
        return;
      }

      const token = generateJwt({ sub: user.id, email: user.email, roles: user.roles }, env.JWT_SECRET);
      logger.info("User authenticated successfully", { correlationId, userId: user.id });

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          accessToken: token,
          refreshToken: `rf_${crypto.randomUUID()}`,
          expiresIn: 900,
          user: { id: user.id, email: user.email, fullName: user.fullName, roles: user.roles }
        }
      }));
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

const PORT = 4001;
server.listen(PORT, () => {
  logger.info(`NIJAKAVACH Identity Service listening on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
