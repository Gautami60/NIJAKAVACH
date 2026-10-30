import * as dotenv from "dotenv";
import { z } from "zod";

// Load local environment files if present
dotenv.config();

/**
 * Base Application Environment Configuration Schema
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().default(4000),

  // Security
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long").default("dev_jwt_secret_must_be_at_least_32_characters_long_for_security"),
  INTERNAL_SERVICE_API_KEY: z.string().min(16).default("nijakavach_internal_svc_dev_key_secure_mesh"),
  AES_256_GCM_ENCRYPTION_KEY: z.string().length(64).default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  HMAC_PEPPER_SECRET: z.string().min(32).default("deterministic_hmac_pepper_dev_secret_64chars_long_entropy_value"),

  // Infrastructure
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres_dev_password@localhost:5432/nijakavach_dev?schema=public"),
  REDIS_URL: z.string().default("redis://:redis_dev_secret@localhost:6379/0"),
  RABBITMQ_URL: z.string().default("amqp://nijakavach:rabbit_dev_password@localhost:5672"),

  // Object Storage
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("ap-south-1"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_BUCKET_EVIDENCE: z.string().default("nijakavach-evidence-dev")
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Strict Environment Validator.
 * Crashes immediately with formatted diagnostic output if invalid.
 */
export function validateEnv<T extends z.ZodTypeAny>(schema: T = BaseEnvSchema as unknown as T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error("FATAL: Environment configuration validation failed:");
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
}
