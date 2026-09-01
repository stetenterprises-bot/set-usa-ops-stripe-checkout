import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { CustomerPurchasingOrchestrator } from "../src/purchasing-orchestrator.js";
import type { PrivyPurchaseBridge } from "../src/privy-bridge.js";
import type { PostgresPurchaseStore, PurchaseRequestRecord } from "../src/purchase-store.js";

const walletAddress = "0x0000000000000000000000000000000000000001";

function purchaseRecord(overrides: Partial<PurchaseRequestRecord> = {}): PurchaseRequestRecord {
  return {
    request_id: "req_quote",
    owner_privy_user_id: "did:privy:user_1",
    state: "awaiting_quote",
    version: 7,
    exact_answers: {},
    normalized_intake: {
      request_id: "req_quote",
      approval_state: "intake",
      exact_answers: { cryptocurrency: "USDC", cryptocurrency_amount: "20", payment: "up to 25 USD", post_purchase: "none" },
      destination_asset: "usdc",
      destination_network: "base",
      destination_amount: "20.00",
      source_currency: "usd",
      source_budget: "25.00",
      customer_geography: "US-IL",
      post_purchase_intent: "none"
    },
    privy_wallet_id: "wallet_1",
    wallet_address: walletAddress,
    wallet_chain_type: "ethereum",
    destination_asset: "usdc",
    destination_network: "base",
    source_currency: "usd",
    source_amount: "25.00",
    destination_amount: "20.00",
    quote_id: null,
    quote_expires_at: null,
    quote_snapshot: null,
    quote_fees: null,
    quote_expiry_source: null,
    approval_digest: null,
    approval_nonce_hash: null,
    approval_consumed_at: null,
    onramp_session_id: null,
    onramp_mode: "sandbox",
    provider_status: null,
    delivered_amount: null,
    transaction_id: null,
    entitlement_status: "locked",
    entitlement_type: "verified_crypto_delivery",
    entitlement_released_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    ...overrides
  };
}

function authenticatedPrivy(): PrivyPurchaseBridge {
  return {
    authenticate: vi.fn().mockResolvedValue({
      userId: "did:privy:user_1",
      sessionId: "session_1",
      appId: "cmt7hoxq900i20cl79s3r6sva",
      issuer: "privy.io",
      issuedAt: 1,
      expiration: 2_000_000_000
    })
  } as unknown as PrivyPurchaseBridge;
}

describe("customer purchasing orchestrator", () => {
  it("uses one Stripe amount constraint and surfaces a fiat-budget comparison when both amounts were requested", async () => {
    let current = purchaseRecord();
    const store = {
      getRequest: vi.fn(async () => current),
      recordQuote: vi.fn(async (_requestId, quote) => {
        current = purchaseRecord({
          state: "quote_ready",
          version: 8,
          quote_id: quote.quoteId,
          quote_expires_at: quote.quoteExpiresAt,
          quote_snapshot: quote.safeSnapshot,
          quote_fees: quote.fees,
          quote_expiry_source: quote.expirySource,
          source_amount: quote.sourceAmount,
          destination_amount: quote.destinationAmount
        });
        return current;
      }),
      recordApproval: vi.fn(async (_requestId, approval) => {
        current = purchaseRecord({
          ...current,
          state: "awaiting_approval",
          version: 9,
          approval_digest: approval.digest
        });
        return current;
      })
    } as unknown as PostgresPurchaseStore;
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        rate_fetched_at: Math.floor(Date.now() / 1000),
        destination_network_quotes: {
          base_network: [{
            id: "quote_base_1",
            destination_currency: "usdc",
            destination_network: "base",
            destination_amount: "20.00",
            source_amount: "24.00",
            source_total_amount: "25.50",
            fees: { network_fee_monetary: "0.50", transaction_fee_monetary: "1.00" }
          }]
        }
      }
    });
    const orchestrator = new CustomerPurchasingOrchestrator({
      store,
      privy: authenticatedPrivy(),
      stripe: { rawRequest } as never,
      approvalSigningKey: "a".repeat(32),
      onrampMode: "sandbox"
    });

    const result = await orchestrator.prepareQuoteAndApproval("req_quote", "Bearer token");

    expect(rawRequest).toHaveBeenCalledWith("GET", "/v1/crypto/onramp/quotes", {
      source_currency: "usd",
      destination_currencies: ["usdc"],
      destination_networks: ["base"],
      destination_amount: "20.00"
    });
    expect(result.constraintReview).toEqual({
      providerConstraint: "destination_amount",
      requestedSourceBudget: "25.00",
      requestedDestinationAmount: "20.00",
      quotedSourceTotalAmount: "25.50",
      estimatedDestinationAmount: "20.00",
      withinSourceBudget: false,
      destinationTargetMatched: true
    });
    expect(result.quote.sourceTotalAmount).toBe("25.50");
    expect(result.approval.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("releases only destination-matched, signature-verified sandbox delivery evidence", async () => {
    const webhookSecret = ["whsec", "unit", "test"].join("_");
    const completed = purchaseRecord({
      state: "fulfillment_complete",
      onramp_session_id: "cos_test_1",
      provider_status: "fulfillment_complete",
      delivered_amount: "20.00",
      transaction_id: "0xtx",
      entitlement_status: "released",
      entitlement_released_at: "2026-08-31T12:00:00Z"
    });
    const recordDelivery = vi.fn().mockResolvedValue({ duplicate: false, request: completed });
    const store = {
      getRequestBySessionId: vi.fn().mockResolvedValue(purchaseRecord({ state: "awaiting_customer", onramp_session_id: "cos_test_1" })),
      recordDelivery,
      resolveRecovery: vi.fn(),
      enqueueRecovery: vi.fn()
    } as unknown as PostgresPurchaseStore;
    const orchestrator = new CustomerPurchasingOrchestrator({
      store,
      privy: authenticatedPrivy(),
      stripe: { rawRequest: vi.fn() } as never,
      approvalSigningKey: "b".repeat(32),
      onrampMode: "sandbox"
    });
    const payload = JSON.stringify({
      id: "evt_onramp_match",
      object: "event",
      type: "crypto.onramp_session.updated",
      livemode: false,
      data: { object: {
        id: "cos_test_1",
        status: "fulfillment_complete",
        transaction_details: {
          transaction_id: "0xtx",
          destination_amount: "20.00",
          destination_currency: "usdc",
          destination_network: "base",
          wallet_address: walletAddress
        }
      } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    const result = await orchestrator.processSignedWebhook(Buffer.from(payload), signature, webhookSecret);

    expect(result.purchase.entitlement.status).toBe("released");
    expect(recordDelivery.mock.calls[0]?.[1]).toMatchObject({
      providerStatus: "fulfillment_complete",
      deliveredAmount: "20.00",
      transactionId: "0xtx"
    });
  });

  it("does not pass mismatched destination evidence to the entitlement transition", async () => {
    const webhookSecret = ["whsec", "unit", "mismatch"].join("_");
    const reconciliation = purchaseRecord({ state: "reconciliation_required", onramp_session_id: "cos_test_2" });
    const recordDelivery = vi.fn().mockResolvedValue({ duplicate: false, request: reconciliation });
    const store = {
      getRequestBySessionId: vi.fn().mockResolvedValue(purchaseRecord({ state: "awaiting_customer", onramp_session_id: "cos_test_2" })),
      recordDelivery,
      resolveRecovery: vi.fn(),
      enqueueRecovery: vi.fn()
    } as unknown as PostgresPurchaseStore;
    const orchestrator = new CustomerPurchasingOrchestrator({
      store,
      privy: authenticatedPrivy(),
      stripe: { rawRequest: vi.fn() } as never,
      approvalSigningKey: "c".repeat(32),
      onrampMode: "sandbox"
    });
    const payload = JSON.stringify({
      id: "evt_onramp_mismatch",
      object: "event",
      type: "crypto.onramp_session.updated",
      livemode: false,
      data: { object: {
        id: "cos_test_2",
        status: "fulfillment_complete",
        transaction_details: {
          transaction_id: "0xwrong",
          destination_amount: "20.00",
          destination_currency: "usdc",
          destination_network: "base",
          wallet_address: "0x0000000000000000000000000000000000000002"
        }
      } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await orchestrator.processSignedWebhook(Buffer.from(payload), signature, webhookSecret);

    expect(recordDelivery.mock.calls[0]?.[1]).toEqual({ providerStatus: "fulfillment_complete" });
    expect((store.enqueueRecovery as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("req_quote", "webhook_requires_reconciliation");
  });
});
