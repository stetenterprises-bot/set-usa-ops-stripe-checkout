import { describe, expect, it } from "vitest";
import { approvalDigest, assertTransition, normalizeIntake, onrampIdempotencyKey, requiresFreshReview } from "../src/purchase-flow.js";

const intake = {
  exact_answers: { cryptocurrency: "USDC", cryptocurrency_amount: "25.00", payment: "30 USD", post_purchase: "Nothing else" },
  destination_asset: "USDC", destination_network: "BASE", destination_amount: "25.00",
  source_currency: "USD", source_budget: "30.00", customer_geography: "US-IL", post_purchase_intent: "none" as const
};

describe("customer-owned onramp workflow", () => {
  it("normalizes decimal strings without binary floating point", () => {
    const value = normalizeIntake(intake);
    expect(value.request_id).toMatch(/^req_/);
    expect(value.destination_asset).toBe("usdc");
    expect(value.destination_network).toBe("base");
    expect(value.source_budget).toBe("30.00");
  });

  it.each(["1e3", "-1", "1.", ".5", "NaN"])("rejects malformed decimal %s", (amount) => {
    expect(() => normalizeIntake({ ...intake, source_budget: amount })).toThrow();
  });

  it("requires an amount constraint", () => {
    expect(() => normalizeIntake({ ...intake, source_budget: null, destination_amount: null })).toThrow();
  });

  it("prevents client authority from advancing provider states", () => {
    expect(() => assertTransition("awaiting_customer", "payment_processing", "authenticated_customer")).toThrow(/provider evidence/);
    expect(() => assertTransition("awaiting_customer", "payment_processing", "stripe_webhook")).not.toThrow();
  });

  it("requires Privy server evidence for wallet ownership state", () => {
    expect(() => assertTransition("awaiting_wallet", "wallet_created", "authenticated_customer")).toThrow(/Privy/);
    expect(() => assertTransition("awaiting_wallet", "wallet_created", "privy_server")).not.toThrow();
  });

  it("binds approvals and idempotency to immutable versions", () => {
    const snapshot = { requestId: "req_1", privyUserId: "did:privy:1", privyWalletId: "wallet_1", walletAddress: "0x0000000000000000000000000000000000000001", destinationNetwork: "base", destinationAsset: "usdc", sourceAmount: "30.00", sourceCurrency: "usd", destinationAmount: null, quoteId: "quote_1", quoteObservedAt: "2029-12-31T23:59:00Z", quoteExpiresAt: "2030-01-01T00:00:00Z", sourceTotalAmount: "31.25", networkFee: "0.25", transactionFee: "1.00", version: 3 };
    expect(approvalDigest(snapshot, "nonce", "secret")).not.toBe(approvalDigest({ ...snapshot, walletAddress: "0x0000000000000000000000000000000000000002" }, "nonce", "secret"));
    expect(approvalDigest(snapshot, "nonce", "secret")).not.toBe(approvalDigest({ ...snapshot, sourceTotalAmount: "32.00" }, "nonce", "secret"));
    expect(onrampIdempotencyKey("req_1", 3)).toBe("set-onramp-req_1-3");
  });

  it("rejects expired or malformed quotes", () => {
    expect(requiresFreshReview("2020-01-01T00:00:00Z")).toBe(true);
    expect(requiresFreshReview("not-a-date")).toBe(true);
  });
});
