import { createApp, createDefaultPurchasingOrchestrator } from "./app.js";
import { loadConfig } from "./config.js";
import { runPurchaseMigrations } from "./purchase-migration.js";
import { startPurchaseRecoveryWorker } from "./purchase-recovery-worker.js";

const config = loadConfig();
const host = config.stripeMode === "live" ? "0.0.0.0" : "127.0.0.1";

async function start(): Promise<void> {
  if (config.agenticEventsDatabaseUrl) {
    await runPurchaseMigrations(config.agenticEventsDatabaseUrl);
  }
  const purchasingOrchestrator = createDefaultPurchasingOrchestrator(config);
  const app = createApp(config, purchasingOrchestrator ? { purchasingOrchestrator } : {});
  if (purchasingOrchestrator) startPurchaseRecoveryWorker(purchasingOrchestrator);
  app.listen(config.port, host, () => {
    console.info(`SET Stripe server listening on ${host}:${config.port} in ${config.stripeMode ?? "test"} mode`);
  });
}

start().catch((cause: unknown) => {
  console.error(JSON.stringify({
    kind: "purchase_schema_migration_failed",
    error: cause instanceof Error ? cause.message : "unknown_error"
  }));
  process.exitCode = 1;
});
