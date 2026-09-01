import { describe, expect, it, vi } from "vitest";
import { runPurchaseMigrations, type PurchaseMigrationDatabase } from "../src/purchase-migration.js";

const migrationSql = "db/migrations/0001_customer_onramp_flow.sql";

function successfulMigrationClient() {
  const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
  const release = vi.fn();
  const client = { query, release };
  return { poolQuery: vi.fn(), client, connect: vi.fn(async () => client) };
}

describe("customer purchase schema migration", () => {
  it("uses one checked-out client and releases it after an idempotent migration", async () => {
    const db = successfulMigrationClient();
    await runPurchaseMigrations(db as unknown as PurchaseMigrationDatabase, migrationSql);

    expect(db.connect).toHaveBeenCalledOnce();
    expect(db.client.release).toHaveBeenCalledOnce();
    expect(db.client.query.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS purchase_schema_migrations"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS customer_onramp_requests"),
      expect.stringContaining("INSERT INTO purchase_schema_migrations"),
      "COMMIT"
    ]);
  });

  it("reruns the full additive SQL safely instead of relying only on the ledger row", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({ rowCount: 1, rows: [] as Record<string, unknown>[] }));
    const db = { query } as unknown as PurchaseMigrationDatabase;

    await runPurchaseMigrations(db, migrationSql);
    await runPurchaseMigrations(db, migrationSql);

    const calls = query.mock.calls as unknown[][];
    const migrationStatements = calls.filter((call) =>
      typeof call[0] === "string" && call[0].includes("CREATE TABLE IF NOT EXISTS customer_onramp_requests"));
    expect(migrationStatements).toHaveLength(2);
    expect(migrationStatements[0]?.[0]).toContain("ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS entitlement_status");
    expect(calls.filter((call) => typeof call[0] === "string" && call[0].includes("ON CONFLICT (migration_id) DO NOTHING"))).toHaveLength(2);
  });
});
