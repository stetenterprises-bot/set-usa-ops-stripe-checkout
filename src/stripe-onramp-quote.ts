import type Stripe from "stripe";
import {
  validateQuoteSnapshot,
  type OnrampCurrency,
  type OnrampNetwork,
  type QuoteSnapshot
} from "./onramp-automation.js";

export type OnrampQuoteFees = {
  networkFee: string | null;
  transactionFee: string | null;
};

export type CurrentOnrampQuote = {
  quote: QuoteSnapshot;
  fees: OnrampQuoteFees;
  sourceTotalAmount: string | null;
  estimatedSourceAmount: string | null;
  estimatedDestinationAmount: string | null;
  /** Application review expiry. Stripe's estimate response does not promise an expires_at value. */
  expirySource: "set_review_window";
};

export type OnrampQuoteRequest = {
  sourceCurrency: string;
  sourceAmount: string | null;
  destinationCurrency: string;
  destinationNetwork: string;
  destinationAmount: string | null;
};

const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function optionalDecimal(value: unknown): string | null {
  return typeof value === "string" && decimal.test(value) ? value : null;
}

function rawQuoteParams(request: OnrampQuoteRequest): Record<string, unknown> {
  const sourceCurrency = request.sourceCurrency.trim().toLowerCase();
  const destinationCurrency = request.destinationCurrency.trim().toLowerCase();
  const destinationNetwork = request.destinationNetwork.trim().toLowerCase();
  if (sourceCurrency !== "usd") throw new Error("The current Stripe Onramp Quotes API bridge supports USD source amounts only.");
  if ((request.sourceAmount === null) === (request.destinationAmount === null)) {
    throw new Error("Specify exactly one source or destination amount.");
  }
  const amount = request.sourceAmount ?? request.destinationAmount;
  if (!amount || !decimal.test(amount)) throw new Error("The quote amount must be a decimal string.");
  return {
    source_currency: sourceCurrency,
    destination_currencies: [destinationCurrency],
    destination_networks: [destinationNetwork],
    ...(request.sourceAmount !== null
      ? { source_amount: request.sourceAmount }
      : { destination_amount: request.destinationAmount })
  };
}

type StripeQuoteItem = {
  id?: unknown;
  destination_currency?: unknown;
  destination_network?: unknown;
  destination_amount?: unknown;
  source_amount?: unknown;
  source_total_amount?: unknown;
  fees?: {
    network_fee_monetary?: unknown;
    transaction_fee_monetary?: unknown;
  };
};

type StripeQuoteResponse = {
  rate_fetched_at?: unknown;
  destination_network_quotes?: Record<string, unknown>;
};

export async function fetchCurrentOnrampQuote(
  stripe: Pick<Stripe, "rawRequest">,
  request: OnrampQuoteRequest,
  options: { now?: Date; reviewWindowSeconds?: number; maxProviderQuoteAgeSeconds?: number } = {}
): Promise<CurrentOnrampQuote> {
  const now = options.now ?? new Date();
  const reviewWindowSeconds = options.reviewWindowSeconds ?? 60;
  const maxProviderQuoteAgeSeconds = options.maxProviderQuoteAgeSeconds ?? 300;
  if (!Number.isInteger(reviewWindowSeconds) || reviewWindowSeconds < 15 || reviewWindowSeconds > 300) {
    throw new Error("The quote review window must be 15-300 seconds.");
  }
  if (!Number.isInteger(maxProviderQuoteAgeSeconds) || maxProviderQuoteAgeSeconds < 30 || maxProviderQuoteAgeSeconds > 900) {
    throw new Error("The maximum provider quote age must be 30-900 seconds.");
  }
  const params = rawQuoteParams(request);
  const response = await stripe.rawRequest("GET", "/v1/crypto/onramp/quotes", params);
  const data = response.data as StripeQuoteResponse;
  const network = request.destinationNetwork.trim().toLowerCase();
  const currency = request.destinationCurrency.trim().toLowerCase();
  // Stripe's generated quote object currently exposes Base under the
  // base_network property while each quote's destination_network is "base".
  const networkQuotes = data.destination_network_quotes?.[network]
    ?? (network === "base" ? data.destination_network_quotes?.base_network : undefined);
  if (!Array.isArray(networkQuotes)) throw new Error("Stripe returned no quote list for the requested network.");
  const selected = (networkQuotes as StripeQuoteItem[]).find((item) =>
    item.destination_network === network && item.destination_currency === currency);
  if (!selected || typeof selected.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(selected.id)) {
    throw new Error("Stripe returned no quote for the requested asset and network.");
  }
  if (typeof data.rate_fetched_at !== "number" || !Number.isFinite(data.rate_fetched_at)) {
    throw new Error("Stripe returned no valid quote observation time.");
  }
  const observedAt = new Date(data.rate_fetched_at * 1000);
  const quoteAgeMilliseconds = now.valueOf() - observedAt.valueOf();
  if (quoteAgeMilliseconds < -30_000 || quoteAgeMilliseconds > maxProviderQuoteAgeSeconds * 1000) {
    throw new Error("Stripe returned a stale or future-dated quote.");
  }
  const networkFee = optionalDecimal(selected.fees?.network_fee_monetary);
  const transactionFee = optionalDecimal(selected.fees?.transaction_fee_monetary);
  const sourceTotalAmount = optionalDecimal(selected.source_total_amount);
  const estimatedSourceAmount = optionalDecimal(selected.source_amount);
  const estimatedDestinationAmount = optionalDecimal(selected.destination_amount);
  if (networkFee === null || transactionFee === null || sourceTotalAmount === null ||
      estimatedSourceAmount === null || estimatedDestinationAmount === null) {
    throw new Error("Stripe returned an incomplete quote total, amount, or fee breakdown.");
  }
  const quote: QuoteSnapshot = {
    quoteId: selected.id,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(now.valueOf() + reviewWindowSeconds * 1000).toISOString(),
    sourceCurrency: request.sourceCurrency.trim().toLowerCase(),
    sourceAmount: request.sourceAmount,
    destinationCurrency: currency as OnrampCurrency,
    destinationNetwork: network as OnrampNetwork,
    destinationAmount: request.destinationAmount
  };
  // The immutable snapshot validator also checks supported pair and amount exclusivity.
  const validated = validateQuoteSnapshot(quote, now);
  if (!validated.ok) throw new Error(validated.error);
  return {
    quote: validated.quote,
    fees: {
      networkFee,
      transactionFee
    },
    sourceTotalAmount,
    estimatedSourceAmount,
    estimatedDestinationAmount,
    expirySource: "set_review_window"
  };
}
