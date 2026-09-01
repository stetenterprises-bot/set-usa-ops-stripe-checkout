import { describe, expect, it, vi } from "vitest";
import { startPurchaseRecoveryWorker } from "../src/purchase-recovery-worker.js";

describe("purchase recovery worker", () => {
  it("runs immediately, prevents overlap, and can be stopped", async () => {
    let finish: ((value: { expiredQuotes: number; examined: number; resolved: number; deferred: number }) => void) | undefined;
    const runRecovery = vi.fn(() => new Promise<{ expiredQuotes: number; examined: number; resolved: number; deferred: number }>((resolve) => {
      finish = resolve;
    }));
    const worker = startPurchaseRecoveryWorker({ runRecovery } as never, { intervalMs: 3_600_000, batchSize: 10 });
    await vi.waitFor(() => expect(runRecovery).toHaveBeenCalledTimes(1));

    await worker.runNow();
    expect(runRecovery).toHaveBeenCalledTimes(1);

    finish?.({ expiredQuotes: 0, examined: 0, resolved: 0, deferred: 0 });
    await vi.waitFor(() => expect(runRecovery).toHaveBeenCalledTimes(1));
    worker.stop();
    await worker.runNow();
    expect(runRecovery).toHaveBeenCalledTimes(1);
  });
});
