import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

type PurchaseMigrationExecutor = Pick<Pool, "query">;
type PurchaseMigrationClient = PurchaseMigrationExecutor & { release: () => void };

/** The small part of pg required by the purchase migration runner. */
export type PurchaseMigrationDatabase = PurchaseMigrationExecutor & {
  connect?: () => Promise<PurchaseMigrationClient>;
};

const MIGRATION_ID = "0001_customer_onramp_flow";
const MIGRATION_FILE = "0001_customer_onramp_flow.sql";
const MIGRATION_LOCK = "set_usa_ops_customer_onramp";

function migrationPath(): string {
  return join(process.cwd(), "db", "migrations", MIGRATION_FILE);
}

/**
 * Apply the customer purchasing schema once, recording the migration in a
 * durable table. The migration SQL itself is intentionally idempotent; the
 * migration ledger and transaction-level advisory lock also make concurrent
 * service starts safe.
 */
export async function runPurchaseMigrations(
  connectionStringOrDatabase: string | PurchaseMigrationDatabase,
  sqlPath = migrationPath()
): Promise<void> {
  const ownsPool = typeof connectionStringOrDatabase === "string";
  const database = ownsPool
    ? new Pool({ connectionString: connectionStringOrDatabase, max: 1 })
    : connectionStringOrDatabase;
  const client = database.connect ? await database.connect() : null;
  const transaction = client ?? database;

  try {
    const sql = await readFile(sqlPath, "utf8");
    await transaction.query("BEGIN");
    try {
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MIGRATION_LOCK]);
      await transaction.query(`
        CREATE TABLE IF NOT EXISTS purchase_schema_migrations (
          migration_id TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // The SQL uses IF NOT EXISTS throughout and also contains upgrade-safe
      // ALTERs. Re-run it under the lock so an installation recorded before a
      // later additive column still converges to the current schema.
      await transaction.query(sql);
      await transaction.query(
        "INSERT INTO purchase_schema_migrations (migration_id) VALUES ($1) ON CONFLICT (migration_id) DO NOTHING",
        [MIGRATION_ID]
      );
      await transaction.query("COMMIT");
    } catch (cause) {
      try {
        await transaction.query("ROLLBACK");
      } catch {
        // Preserve the migration failure if rollback itself is unavailable.
      }
      throw cause;
    }
  } finally {
    client?.release();
    if (ownsPool) await (database as Pool).end();
  }
}

/** Descriptive alias for callers that want startup-oriented naming. */
export const ensurePurchaseSchema = runPurchaseMigrations;
