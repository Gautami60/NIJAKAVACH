import { Pool, PoolClient, PoolConfig } from "pg";
import { createLogger } from "@nijakavach/logger";

const logger = createLogger("source-registry-db");

export interface DatabaseHealthResult {
  isHealthy: boolean;
  latencyMs: number;
  error?: string;
}

export function createDatabasePool(customConfig?: PoolConfig): Pool {
  const connectionString =
    process.env.SOURCES_DB_URL ||
    process.env.DATABASE_URL ||
    "postgresql://sources_svc_role:sources_dev_pwd@localhost:5432/nijakavach_dev?schema=sources";

  const config: PoolConfig = {
    connectionString,
    max: process.env.PG_MAX_POOL_SIZE ? parseInt(process.env.PG_MAX_POOL_SIZE, 10) : 10,
    idleTimeoutMillis: process.env.PG_IDLE_TIMEOUT_MS ? parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10) : 30000,
    connectionTimeoutMillis: process.env.PG_CONNECTION_TIMEOUT_MS ? parseInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10) : 5000,
    ...customConfig
  };

  const pool = new Pool(config);

  pool.on("connect", (client) => {
    // Enforce statement timeout and search_path on each acquired connection
    client.query("SET search_path TO sources, public; SET statement_timeout = 10000;").catch((err) => {
      logger.warn("Failed to set connection defaults for sources pool", { error: err.message });
    });
  });

  pool.on("error", (err) => {
    logger.error("Unexpected error on idle PostgreSQL client in sources pool", { error: err.message });
  });

  return pool;
}

export async function checkDatabaseHealth(pool: Pool): Promise<DatabaseHealthResult> {
  const startTime = Date.now();
  try {
    const res = await pool.query("SELECT 1 AS health_check;");
    const latencyMs = Date.now() - startTime;
    return {
      isHealthy: res.rowCount === 1,
      latencyMs
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      isHealthy: false,
      latencyMs,
      error: err.message || "Database ping failed"
    };
  }
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const result = await callback(client);
    await client.query("COMMIT;");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK;");
    } catch (rollbackErr: any) {
      logger.error("Error during transaction rollback", { error: rollbackErr.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabasePool(pool: Pool): Promise<void> {
  try {
    await pool.end();
    logger.info("Source Registry PostgreSQL pool closed successfully");
  } catch (err: any) {
    logger.warn("Error closing Source Registry PostgreSQL pool", { error: err.message });
  }
}

