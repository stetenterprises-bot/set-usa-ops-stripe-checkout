import { describe, expect, it, vi } from "vitest";
import { fetchCurrentOnrampQuote } from "../src/stripe-onramp-quote.js";

describe("Stripe Onramp quote adapter", () => {
  it("selects the exact pair and labels the expiry as a SET review window", async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        rate_fetched_at: 1_788_213_600,
        destination_network_quotes: {
          ethereum: [{
            id: "quote_usdc_eth",
            destination_currency: "usdc",
            destination_network: "ethereum",
            destination_amount: "19.10",
            source_amount: "20.00",
            source_total_amount: "21.25",
            fees: { network_fee_monetary: "0.25", transaction_fee_monetary: "1.00" }
          }]
        }
      }
    });
    const now = new Date("2026-08-31T22:00:00.000Z");
    const result = await fetchCurrentOnrampQuote({ rawRequest } as never, {
      sourceCurrency: "usd",
      sourceAmount: "20.00",
      destinationCurrency: "usdc",
      destinationNetwork: "ethereum",
      destinationAmount: null
    }, { now, reviewWindowSeconds: 60 });
    expect(result).toMatchObject({
      expirySource: "set_review_window",
      sourceTotalAmount: "21.25",
      estimatedSourceAmount: "20.00",
      estimatedDestinationAmount: "19.10",
      fees: { networkFee: "0.25", transactionFee: "1.00" },
      quote: { quoteId: "quote_usdc_eth", sourceAmount: "20.00", destinationAmount: null }
    });
    expect(result.quote.expiresAt).toBe("2026-08-31T22:01:00.000Z");
    expect(rawRequest).toHaveBeenCalledWith("GET", "/v1/crypto/onramp/quotes", {
      source_currency: "usd",
      source_amount: "20.00",
      destination_currencies: ["usdc"],
      destination_networks: ["ethereum"]
    });
  });

  it("fails closed when Stripe returns no exact pair", async () => {
    const rawRequest = vi.fn().mockResolvedValue({ data: { destination_network_quotes: { ethereum: [] } } });
    await expect(fetchCurrentOnrampQuote({ rawRequest } as never, {
      sourceCurrency: "usd", sourceAmount: "20.00", destinationCurrency: "usdc",
      destinationNetwork: "ethereum", destinationAmount: null
    })).rejects.toThrow("no quote");
  });

  it("handles Stripe's Base quote collection name without changing the network sent to the API", async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        rate_fetched_at: 1_788_213_600,
        destination_network_quotes: {
          base_network: [{
            id: "quote_usdc_base",
            destination_currency: "usdc",
            destination_network: "base",
            destination_amount: "20.00",
            source_amount: "21.00",
            source_total_amount: "22.00",
            fees: { network_fee_monetary: "0.25", transaction_fee_monetary: "0.75" }
          }]
        }
      }
    });
    const result = await fetchCurrentOnrampQuote({ rawRequest } as never, {
      sourceCurrency: "usd", sourceAmount: null, destinationCurrency: "usdc",
      destinationNetwork: "base", destinationAmount: "20.00"
    }, { now: new Date("2026-08-31T22:00:00.000Z") });
    expect(result.quote).toMatchObject({ destinationNetwork: "base", destinationAmount: "20.00" });
    expect(rawRequest).toHaveBeenCalledWith("GET", "/v1/crypto/onramp/quotes", expect.objectContaining({ destination_networks: ["base"] }));
  });

  it("rejects stale or incomplete price evidence", async () => {
    const stale = vi.fn().mockResolvedValue({
      data: {
        rate_fetched_at: 1_700_000_000,
        destination_network_quotes: { ethereum: [{
          id: "quote_stale", destination_currency: "usdc", destination_network: "ethereum",
          source_amount: "20", destination_amount: "19", source_total_amount: "21",
          fees: { network_fee_monetary: "0.25", transaction_fee_monetary: "0.75" }
        }] }
      }
    });
    await expect(fetchCurrentOnrampQuote({ rawRequest: stale } as never, {
      sourceCurrency: "usd", sourceAmount: "20", destinationCurrency: "usdc",
      destinationNetwork: "ethereum", destinationAmount: null
    }, { now: new Date("2026-08-31T22:00:00.000Z") })).rejects.toThrow(/stale/);
  });
});
