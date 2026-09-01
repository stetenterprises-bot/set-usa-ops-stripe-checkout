import { describe, expect, it, vi } from "vitest";
import { approvalNonceHash, PostgresPurchaseStore, type PurchaseDatabase } from "../src/purchase-store.js";

function databaseReturning(...results: Array<{ rowCount: number; rows?: readonly Record<string, unknown>[] }>): PurchaseDatabase & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async () => {
    const result = results.shift();
    if (!result) throw new Error("Unexpected database query in test.");
    return { rowCount: result.rowCount, rows: result.rows ?? [] };
  });
  return { query: calls, calls } as unknown as PurchaseDatabase & { calls: ReturnType<typeof vi.fn> };
}

const request = {
  request_id: "req_1", owner_privy_user_id: null, state: "awaiting_wallet", version: 1,
  exact_answers: {}, normalized_intake: {}, privy_wallet_id: null, wallet_address: null,
  wallet_chain_type: null, destination_asset: "usdc", destination_network: "base",
  source_currency: "usd", source_amount: null, destination_amount: "25.00", quote_id: null,
  quote_expires_at: null, approval_digest: null, approval_nonce_hash: null,
  approval_consumed_at: null, onramp_session_id: null, onramp_mode: "sandbox",
  provider_status: null, delivered_amount: null, transaction_id: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"
} as const;

describe("durable purchase request store", () => {
  it("claims a provider event atomically and suppresses conflicts", async () => {
    const db = databaseReturning({ rowCount: 1, rows: [{ event_id: "evt_1" }] }, { rowCount: 0 });
    const store = new PostgresPurchaseStore(db);
    const event = {
      eventId: "evt_1", requestId: "req_1", eventType: "crypto.onramp_session.updated",
      signatureVerified: true as const, providerStatus: "fulfilled", safePayload: { id: "sess_1" }
    };
    expect(await store.claimEvent(event)).toBe(true);
    expect(await store.claimEvent(event)).toBe(false);
    expect(db.calls.mock.calls[0]?.[0]).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(db.calls.mock.calls[0]?.[1]).toEqual(["evt_1", "req_1", "crypto.onramp_session.updated", "fulfilled", '{"id":"sess_1"}']);
  });

  it("persists wallet ownership and confirmation in one transaction", async () => {
    const updated = { ...request, state: "wallet_created", version: 2, owner_privy_user_id: "did:privy:u1" };
    const db = databaseReturning(
      { rowCount: 0 },
      { rowCount: 1, rows: [request] },
      { rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 0 },
      { rowCount: 1, rows: [updated] }
    );
    const store = new PostgresPurchaseStore(db);
    const result = await store.recordWallet("req_1", {
      privyUserId: "did:privy:u1", privyWalletId: "wallet_1",
      walletAddress: "0x0000000000000000000000000000000000000001", walletChainType: "ethereum",
      network: "base", asset: "usdc", nonce: "one-time", state: "wallet_created"
    });
    expect(result.state).toBe("wallet_created");
    expect(db.calls.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN", expect.stringContaining("FOR UPDATE"), expect.stringContaining("wallet_confirmations"),
      expect.stringContaining("UPDATE customer_onramp_requests"), "COMMIT", expect.stringContaining("SELECT request_id")
    ]);
    expect(db.calls.mock.calls[2]?.[1]?.[7]).toBe(approvalNonceHash("one-time"));
  });

  it("uses one checked-out client for real transactions", async () => {
    const poolQuery = vi.fn();
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [request] }) // FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // wallet confirmation
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // request update
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // COMMIT
    const release = vi.fn();
    const db = { query: poolQuery, connect: vi.fn(async () => ({ query: clientQuery, release })) } as unknown as PurchaseDatabase;
    poolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ...request, state: "wallet_created", version: 2 }] });
    const store = new PostgresPurchaseStore(db);

    await store.recordWallet("req_1", {
      privyUserId: "did:privy:u1", privyWalletId: "wallet_1",
      walletAddress: "0x0000000000000000000000000000000000000001", walletChainType: "ethereum",
      network: "base", asset: "usdc", nonce: "one-time", state: "wallet_created"
    });

    expect(db.connect).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls.map((call) => call[0])).toEqual([
      "BEGIN", expect.stringContaining("FOR UPDATE"), expect.stringContaining("wallet_confirmations"),
      expect.stringContaining("UPDATE customer_onramp_requests"), "COMMIT"
    ]);
    expect(poolQuery.mock.calls.map((call) => call[0])).toEqual([expect.stringContaining("SELECT request_id")]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("binds an owner once and rejects a conflicting verified user", async () => {
    const db = databaseReturning(
      { rowCount: 0 },
      { rowCount: 1, rows: [request] },
      { rowCount: 1, rows: [] },
      { rowCount: 0 },
      { rowCount: 1, rows: [{ ...request, owner_privy_user_id: "did:privy:u1" }] }
    );
    const store = new PostgresPurchaseStore(db);
    await expect(store.bindOwner("req_1", "did:privy:u1")).resolves.toMatchObject({ owner_privy_user_id: "did:privy:u1" });
    expect(db.calls.mock.calls[2]?.[0]).toContain("owner_privy_user_id IS NULL");

    const conflictingDb = databaseReturning(
      { rowCount: 0 },
      { rowCount: 1, rows: [{ ...request, owner_privy_user_id: "did:privy:u1" }] },
      { rowCount: 0 }
    );
    await expect(new PostgresPurchaseStore(conflictingDb).bindOwner("req_1", "did:privy:u2"))
      .rejects.toThrow("different Privy user");
  });

  it("consumes an approval once with a compare-and-set update", async () => {
    const approved = { ...request, state: "approved", version: 4, approval_digest: "digest" };
    const db = databaseReturning({ rowCount: 1, rows: [approved] });
    const store = new PostgresPurchaseStore(db);
    const result = await store.consumeApproval("req_1", "digest", "nonce");
    expect(result.consumed).toBe(true);
    expect(result.request?.state).toBe("approved");
    expect(db.calls.mock.calls[0]?.[0]).toContain("approval_consumed_at IS NULL");
    expect(db.calls.mock.calls[0]?.[0]).toContain("quote_expires_at > NOW()");
    expect(db.calls.mock.calls[0]?.[1]).toEqual(["req_1", "digest", approvalNonceHash("nonce")]);
  });

  it("offers only ambiguous or in-flight requests to recovery workers", async () => {
    const db = databaseReturning({ rowCount: 2, rows: [
      { request_id: "req_1", state: "reconciliation_required" },
      { request_id: "req_2", state: "payment_processing" }
    ] });
    const store = new PostgresPurchaseStore(db);
    const candidates = await store.findReconciliationCandidates(25);
    expect(candidates.map((candidate) => candidate.request_id)).toEqual(["req_1", "req_2"]);
    expect(db.calls.mock.calls[0]?.[0]).toContain("state IN ('session_creating', 'payment_processing', 'fulfillment_processing')");
    expect(db.calls.mock.calls[0]?.[1]).toEqual([25]);
  });

  it("claims due recovery work with an expiring lease", async () => {
    const db = databaseReturning({ rowCount: 1, rows: [{ request_id: "req_1", lease_owner: "worker" }] });
    const store = new PostgresPurchaseStore(db);
    await store.listDueRecovery(25);
    expect(db.calls.mock.calls[0]?.[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(db.calls.mock.calls[0]?.[0]).toContain("lease_expires_at <= NOW()");
    expect(db.calls.mock.calls[0]?.[1]?.[0]).toBe(25);
  });

  it("does not let an out-of-order nonterminal webhook roll back fulfillment", async () => {
    const fulfilled = {
      ...request,
      state: "fulfillment_complete",
      version: 8,
      onramp_session_id: "cos_1",
      provider_status: "fulfillment_complete",
      delivered_amount: "25.00",
      transaction_id: "tx_1",
      entitlement_status: "released",
      entitlement_type: "verified_crypto_delivery",
      entitlement_released_at: "2030-01-01T00:00:00.000Z"
    };
    const db = databaseReturning(
      { rowCount: 1 }, // BEGIN
      { rowCount: 1, rows: [{ event_id: "evt_late_initialized" }] },
      { rowCount: 1, rows: [fulfilled] },
      { rowCount: 1 }, // processed_at
      { rowCount: 1 } // COMMIT
    );
    const store = new PostgresPurchaseStore(db);
    const result = await store.recordDelivery({
      eventId: "evt_late_initialized",
      requestId: "req_1",
      eventType: "crypto.onramp_session.updated",
      signatureVerified: true,
      providerStatus: "initialized",
      safePayload: { sessionId: "cos_1", status: "initialized" }
    }, { providerStatus: "initialized" });

    expect(result.duplicate).toBe(false);
    expect(result.request).toMatchObject({
      state: "fulfillment_complete",
      transaction_id: "tx_1",
      entitlement_status: "released"
    });
    expect(db.calls.mock.calls[3]?.[0]).toContain("processed_at = NOW()");
  });

  it("does not let a later fulfillment event overwrite a terminal rejection", async () => {
    const rejected = {
      ...request,
      state: "rejected",
      version: 5,
      onramp_session_id: "cos_2",
      provider_status: "rejected",
      entitlement_status: "locked",
      entitlement_type: "verified_crypto_delivery",
      entitlement_released_at: null
    };
    const db = databaseReturning(
      { rowCount: 1 }, // BEGIN
      { rowCount: 1, rows: [{ event_id: "evt_late_complete" }] },
      { rowCount: 1, rows: [rejected] },
      { rowCount: 1 }, // processed_at
      { rowCount: 1 } // COMMIT
    );
    const store = new PostgresPurchaseStore(db);
    const result = await store.recordDelivery({
      eventId: "evt_late_complete",
      requestId: "req_1",
      eventType: "crypto.onramp_session.updated",
      signatureVerified: true,
      providerStatus: "fulfillment_complete",
      safePayload: { sessionId: "cos_2", status: "fulfillment_complete" }
    }, { providerStatus: "fulfillment_complete", deliveredAmount: "25.00", transactionId: "tx_late" });

    expect(result.request).toMatchObject({ state: "rejected", transaction_id: null, entitlement_status: "locked" });
    expect(db.calls.mock.calls[3]?.[0]).toContain("processed_at = NOW()");
  });
});
