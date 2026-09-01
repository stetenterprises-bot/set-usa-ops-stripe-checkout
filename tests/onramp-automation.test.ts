import { describe, expect, it, vi } from "vitest";
import {
  buildOnrampSessionRequest,
  createIdempotentOnrampSession,
  decideOnrampRecovery,
  extractFulfillmentEvidence,
  isQuoteExpired,
  normalizeSignedOnrampWebhook,
  onrampIdempotencyKey,
  quoteSnapshotDigest,
  validateQuoteSnapshot,
  type QuoteSnapshot
} from "../src/onramp-automation.js";
import { createEmbeddedOnrampSession } from "../src/onramp.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const quote: QuoteSnapshot = {
  quoteId: "quote_123",
  observedAt: "2029-12-31T23:59:00.000Z",
  expiresAt: "2030-01-01T00:05:00.000Z",
  sourceCurrency: "usd",
  sourceAmount: "30.00",
  destinationCurrency: "usdc",
  destinationNetwork: "ethereum",
  destinationAmount: null
};

const walletAddress = "0x0000000000000000000000000000000000000001";

describe("disjoint Stripe Embedded Onramp automation", () => {
  it("uses the current flattened Onramp create parameters and the supplied idempotency key", async () => {
    const rawRequest = vi.fn().mockResolvedValue({ data: { id: "cos_test", status: "initialized" } });
    await createEmbeddedOnrampSession({ rawRequest } as never, {
      network: "ethereum",
      currency: "usdc",
      walletAddress,
      idempotencyKey: "embedded-onramp-test-1"
    });

    expect(rawRequest).toHaveBeenCalledWith(
      "POST",
      "/v1/crypto/onramp_sessions",
      expect.objectContaining({
        destination_currency: "usdc",
        destination_network: "ethereum",
        destination_currencies: ["usdc"],
        destination_networks: ["ethereum"],
        wallet_addresses: { ethereum: walletAddress },
        lock_wallet_address: true
      }),
      { idempotencyKey: "embedded-onramp-test-1" }
    );
    expect(rawRequest.mock.calls[0]?.[2]).not.toHaveProperty("transaction_details");
  });

  it("builds a deterministic, quote-bound session request", () => {
    const first = buildOnrampSessionRequest({
      requestId: "req_abc123",
      approvalVersion: 3,
      walletAddress,
      quote
    }, now);
    const second = buildOnrampSessionRequest({
      requestId: "req_abc123",
      approvalVersion: 3,
      walletAddress,
      quote
    }, now);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      request: {
        idempotencyKey: "set-onramp-req_abc123-3",
        params: {
          source_currency: "usd",
          source_amount: "30.00",
          destination_currency: "usdc",
          destination_network: "ethereum",
          destination_currencies: ["usdc"],
          destination_networks: ["ethereum"],
          wallet_addresses: { ethereum: walletAddress },
          lock_wallet_address: true
        }
      }
    });
    expect(quoteSnapshotDigest(quote)).toHaveLength(43);
  });

  it("maps a Privy EVM address to Stripe's documented Base network value", () => {
    const built = buildOnrampSessionRequest({
      requestId: "req_base123",
      approvalVersion: 1,
      walletAddress,
      quote: { ...quote, destinationNetwork: "base", destinationCurrency: "usdc" }
    }, now);
    expect(built).toMatchObject({
      ok: true,
      request: { params: { wallet_addresses: { base: walletAddress }, destination_network: "base" } }
    });
  });

  it("rejects arbitrary idempotency keys and expired or conflicting quotes", () => {
    const mismatch = buildOnrampSessionRequest({
      requestId: "req_abc123",
      approvalVersion: 3,
      walletAddress,
      quote,
      idempotencyKey: "set-onramp-other-3"
    }, now);
    expect(mismatch).toMatchObject({ ok: false, code: "idempotency_mismatch" });

    const expired = validateQuoteSnapshot({ ...quote, expiresAt: "2029-12-31T23:59:59.000Z" }, now);
    expect(expired).toMatchObject({ ok: false, code: "expired_quote" });
    expect(isQuoteExpired(quote, new Date("2030-01-01T00:05:00.000Z"))).toBe(true);

    const conflicting = validateQuoteSnapshot({ ...quote, destinationAmount: "0.25" }, now);
    expect(conflicting).toMatchObject({ ok: false, code: "invalid_quote" });
  });

  it("uses the same request-bound idempotency key across a provider retry", async () => {
    const rawRequest = vi.fn().mockResolvedValue({ data: { id: "cos_test_123", status: "initialized", client_secret: "cos_test_secret" } });
    const client = { rawRequest };
    const result = await createIdempotentOnrampSession(client, {
      requestId: "req_retry",
      approvalVersion: 1,
      walletAddress,
      quote
    }, now);

    expect(result.idempotencyKey).toBe(onrampIdempotencyKey("req_retry", 1));
    expect(rawRequest).toHaveBeenCalledWith(
      "POST",
      "/v1/crypto/onramp_sessions",
      expect.objectContaining({ lock_wallet_address: true }),
      { idempotencyKey: "set-onramp-req_retry-1" }
    );
  });

  it("verifies before normalizing the documented dotted webhook event", () => {
    const constructEvent = vi.fn().mockReturnValue({
      id: "evt_onramp_1",
      type: "crypto.onramp_session.updated",
      livemode: false,
      created: 1893456000,
      data: {
        object: {
          id: "cos_test_123",
          status: "fulfillment_complete",
          client_secret: "cos_test_secret_must_not_escape",
          transaction_details: {
            transaction_id: "tx_123",
            destination_amount: "0.250000",
            destination_currency: "usdc",
            destination_network: "ethereum",
            wallet_address: walletAddress
          }
        }
      }
    });
    const webhookSecret = ["whsec", "test"].join("_");
    const result = normalizeSignedOnrampWebhook(Buffer.from("raw-json"), "t=1,v1=signed", webhookSecret, constructEvent);

    expect(constructEvent).toHaveBeenCalledWith(Buffer.from("raw-json"), "t=1,v1=signed", webhookSecret);
    expect(result).toMatchObject({
      ok: true,
      event: {
        eventId: "evt_onramp_1",
        eventType: "crypto.onramp_session.updated",
        sessionId: "cos_test_123",
        status: "fulfillment_complete",
        fulfillment: {
          kind: "complete",
          transactionId: "tx_123",
          deliveredAmount: "0.250000",
          destinationCurrency: "usdc",
          destinationNetwork: "ethereum",
          walletAddress
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("cos_test_secret");
  });

  it("fails closed for invalid signatures, the existing underscore event name, and undocumented statuses", () => {
    const webhookSecret = ["whsec", "test"].join("_");
    const invalidSignature = normalizeSignedOnrampWebhook("{}", undefined, webhookSecret, vi.fn());
    expect(invalidSignature).toMatchObject({ ok: false, code: "invalid_signature" });

    const makeEvent = (type: string, status: string) => ({
      id: "evt_onramp_2",
      type,
      data: { object: { id: "cos_test_123", status, transaction_details: {} } }
    });
    expect(normalizeSignedOnrampWebhook("{}", "sig", "secret", () => makeEvent("crypto.onramp_session_updated", "initialized")))
      .toMatchObject({ ok: false, code: "unsupported_event_type" });
    expect(normalizeSignedOnrampWebhook("{}", "sig", "secret", () => makeEvent("crypto.onramp_session.updated", "expired")))
      .toMatchObject({ ok: false, code: "unsupported_status" });
  });

  it("does not claim delivery without a transaction identifier", () => {
    const evidence = extractFulfillmentEvidence({
      id: "cos_test_123",
      status: "fulfillment_complete",
      transaction_details: { destination_amount: "1.00" }
    });
    expect(evidence).toMatchObject({ kind: "reconciliation_required", status: "fulfillment_complete" });
    expect(extractFulfillmentEvidence({ id: "cos_test_123", status: "fulfillment_processing" }))
      .toMatchObject({ kind: "processing" });
    expect(extractFulfillmentEvidence({ id: "cos_test_123", status: "canceled" }))
      .toMatchObject({ kind: "fail_closed" });
  });

  it("chooses retry, reconciliation, wait, completion, and no-retry paths explicitly", () => {
    expect(decideOnrampRecovery({ operation: "session_creation", outcome: "timeout", sessionIdKnown: false }))
      .toMatchObject({ action: "retry_same_idempotency" });
    expect(decideOnrampRecovery({ operation: "session_creation", outcome: "timeout", sessionIdKnown: true }))
      .toMatchObject({ action: "reconcile_existing_session" });
    expect(decideOnrampRecovery({ operation: "delivery", status: "fulfillment_complete", transactionIdKnown: true }))
      .toMatchObject({ action: "complete" });
    expect(decideOnrampRecovery({ operation: "delivery", status: "fulfillment_complete", transactionIdKnown: false }))
      .toMatchObject({ action: "reconcile_existing_session" });
    expect(decideOnrampRecovery({ operation: "delivery", status: "rejected" }))
      .toMatchObject({ action: "do_not_retry" });
    expect(decideOnrampRecovery({ operation: "delivery", status: "future_status" }))
      .toMatchObject({ action: "fail_closed" });
  });
});
