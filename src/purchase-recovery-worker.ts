import type { CustomerPurchasingOrchestrator } from "./purchasing-orchestrator.js";

export type PurchaseRecoveryWorker = {
  runNow: () => Promise<void>;
  stop: () => void;
};

export function startPurchaseRecoveryWorker(
  orchestrator: Pick<CustomerPurchasingOrchestrator, "runRecovery">,
  options: { intervalMs?: number; batchSize?: number } = {}
): PurchaseRecoveryWorker {
  const intervalMs = options.intervalMs ?? 30_000;
  const batchSize = options.batchSize ?? 25;
  if (!Number.isInteger(intervalMs) || intervalMs < 5_000 || intervalMs > 3_600_000) {
    throw new Error("Purchase recovery interval must be 5 seconds through 1 hour.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("Purchase recovery batch size must be 1 through 1000.");
  }

  let running = false;
  let stopped = false;
  const runNow = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await orchestrator.runRecovery(batchSize);
      if (result.expiredQuotes > 0 || result.examined > 0) {
        const entry = { kind: "purchase_recovery_run", ...result };
        if (result.deferred > 0) console.warn(JSON.stringify(entry));
        else console.info(JSON.stringify(entry));
      }
    } catch (cause) {
      console.error(JSON.stringify({
        kind: "purchase_recovery_failed",
        error: cause instanceof Error ? cause.message : "unknown_error"
      }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void runNow(), intervalMs);
  timer.unref();
  void runNow();
  return {
    runNow,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}
