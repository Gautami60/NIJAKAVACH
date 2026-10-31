import * as fs from "node:fs";
import * as path from "node:path";
import { Pool, PoolClient } from "pg";
import { createLogger } from "@nijakavach/logger";

const logger = createLogger("source-registry-migrator");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed?: {
    version: string;
    error: string;
  };
}

export class SourceRegistryMigrator {
  private pool: Pool;
  private migrationsDirectory: string;

  constructor(pool: Pool, migrationsDir?: string) {
    this.pool = pool;
    this.migrationsDirectory =
      migrationsDir ||
      path.resolve(__dirname, "../../../../infrastructure/postgres/migrations");
  }

  private async ensureMigrationTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS sources;
      CREATE TABLE IF NOT EXISTS sources.schema_migrations (
        version VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async runMigrations(): Promise<MigrationResult> {
    const result: MigrationResult = {
      applied: [],
      skipped: []
    };

    if (!fs.existsSync(this.migrationsDirectory)) {
      logger.warn(`Migrations directory not found at ${this.migrationsDirectory}`);
      return result;
    }

    const client = await this.pool.connect();
    try {
      await this.ensureMigrationTable(client);

      const files = fs
        .readdirSync(this.migrationsDirectory)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const file of files) {
        const version = path.basename(file, ".sql");

        const checkRes = await client.query(
          "SELECT version FROM sources.schema_migrations WHERE version = $1;",
          [version]
        );

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          result.skipped.push(version);
          continue;
        }

        const sqlPath = path.join(this.migrationsDirectory, file);
        const sql = fs.readFileSync(sqlPath, "utf-8");

        try {
          await client.query("BEGIN;");
          await client.query(sql);
          await client.query(
            "INSERT INTO sources.schema_migrations (version, applied_at) VALUES ($1, NOW());",
            [version]
          );
          await client.query("COMMIT;");
          logger.info(`Successfully applied migration: ${version}`);
          result.applied.push(version);
        } catch (err: any) {
          await client.query("ROLLBACK;");
          logger.error(`Migration failed: ${version}`, { error: err.message });
          result.failed = {
            version,
            error: err.message
          };
          throw new Error(`Migration ${version} failed: ${err.message}`);
        }
      }

      return result;
    } finally {
      client.release();
    }
  }

  async getAppliedMigrations(): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await this.ensureMigrationTable(client);
      const res = await client.query(
        "SELECT version FROM sources.schema_migrations ORDER BY applied_at ASC;"
      );
      return res.rows.map((r: { version: string }) => r.version);
    } finally {
      client.release();
    }
  }
}

