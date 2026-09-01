import crypto from "node:crypto";
import Stripe from "stripe";

/** Stripe's currently documented Embedded Onramp webhook type. */
export const ONRAMP_WEBHOOK_EVENT_TYPE = "crypto.onramp_session.updated" as const;

/**
 * These are the statuses listed by Stripe's Embedded Onramp documentation.
 * Unknown values are intentionally not treated as terminal, successful, or
 * retryable: a status change must be understood before state can advance.
 */
export const DOCUMENTED_ONRAMP_STATUSES = [
  "initialized",
  "rejected",
  "requires_payment",
  "fulfillment_processing",
  "fulfillment_complete"
] as const;

export type DocumentedOnrampStatus = (typeof DOCUMENTED_ONRAMP_STATUSES)[number];
export type OnrampNetwork = "base" | "bitcoin" | "ethereum" | "solana";
export type OnrampCurrency = "btc" | "eth" | "sol" | "usdc";

const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const requestIdPattern = /^req_[A-Za-z0-9_-]+$/;
const sessionIdPattern = /^cos_[A-Za-z0-9_-]+$/;
const eventIdPattern = /^evt_[A-Za-z0-9_-]+$/;

const SUPPORTED_PAIRS: ReadonlyArray<readonly [OnrampNetwork, OnrampCurrency]> = [
  ["base", "usdc"],
  ["bitcoin", "btc"],
  ["ethereum", "eth"],
  ["ethereum", "usdc"],
  ["solana", "sol"],
  ["solana", "usdc"]
];

export type QuoteSnapshot = {
  quoteId: string;
  expiresAt: string;
  observedAt: string;
  sourceCurrency: string;
  sourceAmount: string | null;
  destinationCurrency: OnrampCurrency;
  destinationNetwork: OnrampNetwork;
  destinationAmount: string | null;
};

export type QuoteSnapshotInput = Omit<QuoteSnapshot, "destinationCurrency" | "destinationNetwork"> & {
  destinationCurrency: string;
  destinationNetwork: string;
};

export type QuoteValidation =
  | { ok: true; quote: QuoteSnapshot }
  | { ok: false; code: "invalid_quote" | "expired_quote"; error: string };

function validDecimal(value: unknown): value is string {
  return typeof value === "string" && decimal.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSupportedPair(network: string, currency: string): network is OnrampNetwork {
  return SUPPORTED_PAIRS.some(([supportedNetwork, supportedCurrency]) =>
    supportedNetwork === network && supportedCurrency === currency);
}

function isWalletAddress(network: OnrampNetwork, value: string): boolean {
  if (network === "ethereum" || network === "base") return /^0x[a-fA-F0-9]{40}$/.test(value);
  if (network === "bitcoin") {
    return /^(?:bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value);
  }
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function isDocumentedOnrampStatus(value: unknown): value is DocumentedOnrampStatus {
  return typeof value === "string" &&
    (DOCUMENTED_ONRAMP_STATUSES as readonly string[]).includes(value);
}

export function quoteSnapshotDigest(quote: QuoteSnapshot): string {
  return crypto.createHash("sha256").update(JSON.stringify(quote)).digest("base64url");
}

export function validateQuoteSnapshot(input: unknown, now = new Date()): QuoteValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "invalid_quote", error: "A quote snapshot is required." };
  }
  const value = input as Record<string, unknown>;
  const destinationCurrency = typeof value.destinationCurrency === "string"
    ? value.destinationCurrency.trim().toLowerCase()
    : "";
  const destinationNetwork = typeof value.destinationNetwork === "string"
    ? value.destinationNetwork.trim().toLowerCase()
    : "";
  const sourceCurrency = typeof value.sourceCurrency === "string"
    ? value.sourceCurrency.trim().toLowerCase()
    : "";
  const sourceAmount = value.sourceAmount;
  const destinationAmount = value.destinationAmount;
  const quoteId = value.quoteId;
  const expiresAt = value.expiresAt;
  const observedAt = value.observedAt;

  if (typeof quoteId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(quoteId) ||
      !/^[a-z]{3}$/.test(sourceCurrency) ||
      !isSupportedPair(destinationNetwork, destinationCurrency) ||
      !validDate(expiresAt) || !validDate(observedAt) ||
      (sourceAmount !== null && !validDecimal(sourceAmount)) ||
      (destinationAmount !== null && !validDecimal(destinationAmount)) ||
      (sourceAmount === null && destinationAmount === null) ||
      (sourceAmount !== null && destinationAmount !== null)) {
    return { ok: false, code: "invalid_quote", error: "The quote snapshot is malformed or has conflicting amount constraints." };
  }

  const quote: QuoteSnapshot = {
    quoteId,
    expiresAt,
    observedAt,
    sourceCurrency,
    sourceAmount,
    destinationCurrency: destinationCurrency as OnrampCurrency,
    destinationNetwork: destinationNetwork as OnrampNetwork,
    destinationAmount
  };
  if (new Date(quote.expiresAt).valueOf() <= now.valueOf()) {
    return { ok: false, code: "expired_quote", error: "The quote has expired and must be refreshed before session creation." };
  }
  return { ok: true, quote };
}

export function isQuoteExpired(quote: QuoteSnapshot, now = new Date()): boolean {
  return Number.isNaN(Date.parse(quote.expiresAt)) || new Date(quote.expiresAt).valueOf() <= now.valueOf();
}

export type OnrampSessionInput = {
  requestId: string;
  approvalVersion: number;
  walletAddress: string;
  quote: QuoteSnapshot;
  idempotencyKey?: string;
  customerIp?: string;
};

export type OnrampSessionRequest = {
  params: {
    source_currency: string;
    destination_currency: OnrampCurrency;
    destination_network: OnrampNetwork;
    destination_currencies: [OnrampCurrency];
    destination_networks: [OnrampNetwork];
    source_amount?: string;
    destination_amount?: string;
    wallet_addresses: { [network: string]: string };
    lock_wallet_address: true;
    customer_ip_address?: string;
  };
  idempotencyKey: string;
  quoteSnapshotHash: string;
};

export type OnrampInputValidation =
  | { ok: true; request: OnrampSessionRequest }
  | { ok: false; code: "invalid_input" | "expired_quote" | "idempotency_mismatch"; error: string };

export function onrampIdempotencyKey(requestId: string, approvalVersion: number): string {
  return `set-onramp-${requestId}-${approvalVersion}`;
}

export function buildOnrampSessionRequest(input: OnrampSessionInput, now = new Date()): OnrampInputValidation {
  if (!requestIdPattern.test(input.requestId) ||
      !Number.isSafeInteger(input.approvalVersion) || input.approvalVersion < 1 ||
      typeof input.walletAddress !== "string") {
    return { ok: false, code: "invalid_input", error: "requestId, approvalVersion, and walletAddress are required." };
  }
  const quoteValidation = validateQuoteSnapshot(input.quote, now);
  if (!quoteValidation.ok) {
    if (quoteValidation.code === "expired_quote") {
      return { ok: false, code: "expired_quote", error: quoteValidation.error };
    }
    return { ok: false, code: "invalid_input", error: quoteValidation.error };
  }
  const quote = quoteValidation.quote;
  const walletAddress = input.walletAddress.trim();
  if (!isWalletAddress(quote.destinationNetwork, walletAddress)) {
    return { ok: false, code: "invalid_input", error: `Enter a valid ${quote.destinationNetwork} wallet address.` };
  }

  const idempotencyKey = onrampIdempotencyKey(input.requestId, input.approvalVersion);
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== idempotencyKey) {
    return { ok: false, code: "idempotency_mismatch", error: "The idempotency key must be bound to requestId and approvalVersion." };
  }
  const transactionDetails = {
    source_currency: quote.sourceCurrency,
    destination_currency: quote.destinationCurrency,
    destination_network: quote.destinationNetwork,
    destination_currencies: [quote.destinationCurrency] as [OnrampCurrency],
    destination_networks: [quote.destinationNetwork] as [OnrampNetwork],
    ...(quote.sourceAmount !== null ? { source_amount: quote.sourceAmount } : {}),
    ...(quote.destinationAmount !== null ? { destination_amount: quote.destinationAmount } : {})
  };
  const customerIp = input.customerIp?.replace(/^::ffff:/, "").trim();
  if (customerIp !== undefined && !/^[0-9a-fA-F:.]{3,45}$/.test(customerIp)) {
    return { ok: false, code: "invalid_input", error: "The customer IP address is invalid." };
  }
  return {
    ok: true,
    request: {
      params: {
        ...transactionDetails,
        wallet_addresses: { [quote.destinationNetwork]: walletAddress },
        lock_wallet_address: true,
        ...(customerIp ? { customer_ip_address: customerIp } : {})
      },
      idempotencyKey,
      quoteSnapshotHash: quoteSnapshotDigest(quote)
    }
  };
}

export type RawOnrampClient = {
  rawRequest: (method: "POST", path: string, params: Record<string, unknown>, options: { idempotencyKey: string }) => Promise<{ data: unknown }>;
};

export type CreatedOnrampSession = { id: string; status: DocumentedOnrampStatus; client_secret?: string | null; livemode?: boolean };

export async function createIdempotentOnrampSession(
  client: RawOnrampClient,
  input: OnrampSessionInput,
  now = new Date()
): Promise<{ session: CreatedOnrampSession; idempotencyKey: string; quoteSnapshotHash: string }> {
  const built = buildOnrampSessionRequest(input, now);
  if (!built.ok) throw new Error(built.error);
  const response = await client.rawRequest("POST", "/v1/crypto/onramp_sessions", built.request.params as unknown as Record<string, unknown>, { idempotencyKey: built.request.idempotencyKey });
  const session = response.data as Record<string, unknown>;
  if (typeof session.id !== "string" || !sessionIdPattern.test(session.id) || !isDocumentedOnrampStatus(session.status)) {
    throw new Error("Stripe returned an unknown or malformed Onramp session.");
  }
  return {
    session: {
      id: session.id,
      status: session.status,
      ...(typeof session.client_secret === "string" || session.client_secret === null ? { client_secret: session.client_secret } : {}),
      ...(typeof session.livemode === "boolean" ? { livemode: session.livemode } : {})
    },
    idempotencyKey: built.request.idempotencyKey,
    quoteSnapshotHash: built.request.quoteSnapshotHash
  };
}

type StripeEventLike = {
  id?: unknown;
  type?: unknown;
  livemode?: unknown;
  created?: unknown;
  data?: { object?: unknown };
};

type SessionLike = {
  id?: unknown;
  status?: unknown;
  transaction_details?: unknown;
};

export type FulfillmentEvidence =
  | { kind: "not_ready"; status: "initialized" | "requires_payment" | "rejected"; sessionId: string }
  | { kind: "processing"; status: "fulfillment_processing"; sessionId: string }
  | { kind: "complete"; status: "fulfillment_complete"; sessionId: string; transactionId: string; deliveredAmount: string; destinationCurrency: string | null; destinationNetwork: string | null; walletAddress: string | null }
  | { kind: "reconciliation_required"; status: "fulfillment_complete"; sessionId: string; reason: string };

function sessionFromUnknown(value: unknown): SessionLike | null {
  return value && typeof value === "object" ? value as SessionLike : null;
}

export function extractFulfillmentEvidence(value: unknown): FulfillmentEvidence | { kind: "fail_closed"; reason: string } {
  const session = sessionFromUnknown(value);
  if (!session || typeof session.id !== "string" || !sessionIdPattern.test(session.id) || !isDocumentedOnrampStatus(session.status)) {
    return { kind: "fail_closed", reason: "The Onramp session ID or status is undocumented or malformed." };
  }
  if (session.status === "initialized" || session.status === "requires_payment" || session.status === "rejected") {
    return { kind: "not_ready", status: session.status, sessionId: session.id };
  }
  if (session.status === "fulfillment_processing") {
    return { kind: "processing", status: session.status, sessionId: session.id };
  }
  const details = session.transaction_details && typeof session.transaction_details === "object"
    ? session.transaction_details as Record<string, unknown>
    : null;
  const transactionId = details?.transaction_id;
  if (typeof transactionId !== "string" || transactionId.trim() === "") {
    return { kind: "reconciliation_required", status: "fulfillment_complete", sessionId: session.id, reason: "fulfillment_complete has no transaction_id." };
  }
  const deliveredAmount = details?.destination_amount;
  if (!validDecimal(deliveredAmount)) {
    return { kind: "reconciliation_required", status: "fulfillment_complete", sessionId: session.id, reason: "The delivered destination amount is malformed." };
  }
  return {
    kind: "complete",
    status: "fulfillment_complete",
    sessionId: session.id,
    transactionId,
    deliveredAmount,
    destinationCurrency: typeof details?.destination_currency === "string" ? details.destination_currency : null,
    destinationNetwork: typeof details?.destination_network === "string" ? details.destination_network : null,
    walletAddress: typeof details?.wallet_address === "string" ? details.wallet_address : null
  };
}

export type NormalizedOnrampWebhook = {
  eventId: string;
  eventType: typeof ONRAMP_WEBHOOK_EVENT_TYPE;
  livemode: boolean | null;
  created: number | null;
  sessionId: string;
  status: DocumentedOnrampStatus;
  fulfillment: FulfillmentEvidence;
};

export type WebhookNormalization =
  | { ok: true; event: NormalizedOnrampWebhook }
  | { ok: false; code: "invalid_signature" | "invalid_payload" | "unsupported_event_type" | "unsupported_status"; error: string };

type ConstructEvent = (payload: string | Buffer, signature: string, secret: string) => unknown;

function defaultConstructEvent(payload: string | Buffer, signature: string, secret: string): unknown {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}

export function normalizeSignedOnrampWebhook(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string,
  constructEvent: ConstructEvent = defaultConstructEvent
): WebhookNormalization {
  if (!signature || !secret) return { ok: false, code: "invalid_signature", error: "A Stripe signature and endpoint secret are required." };
  let parsed: StripeEventLike;
  try {
    const candidate = constructEvent(payload, signature, secret);
    if (!candidate || typeof candidate !== "object") throw new Error("not an event");
    parsed = candidate as StripeEventLike;
  } catch {
    return { ok: false, code: "invalid_signature", error: "Invalid Stripe webhook signature." };
  }
  if (parsed.type !== ONRAMP_WEBHOOK_EVENT_TYPE) {
    return { ok: false, code: "unsupported_event_type", error: "The webhook event type is not the documented Onramp update event." };
  }
  const session = sessionFromUnknown(parsed.data?.object);
  if (!session || typeof session.status !== "string" || !isDocumentedOnrampStatus(session.status)) {
    return { ok: false, code: "unsupported_status", error: "The Onramp status is undocumented or malformed; state was not advanced." };
  }
  if (typeof parsed.id !== "string" || !eventIdPattern.test(parsed.id) || typeof session.id !== "string" || !sessionIdPattern.test(session.id)) {
    return { ok: false, code: "invalid_payload", error: "The signed event or Onramp session identifier is malformed." };
  }
  const fulfillment = extractFulfillmentEvidence(session);
  if (fulfillment.kind === "fail_closed") {
    return { ok: false, code: "invalid_payload", error: fulfillment.reason };
  }
  return {
    ok: true,
    event: {
      eventId: parsed.id,
      eventType: ONRAMP_WEBHOOK_EVENT_TYPE,
      livemode: typeof parsed.livemode === "boolean" ? parsed.livemode : null,
      created: typeof parsed.created === "number" ? parsed.created : null,
      sessionId: session.id,
      status: session.status,
      fulfillment
    }
  };
}

export type RecoveryAction = "retry_same_idempotency" | "reconcile_existing_session" | "await_webhook" | "complete" | "do_not_retry" | "fail_closed";
export type RecoveryDecision = { action: RecoveryAction; reason: string };
export type RecoveryInput = {
  operation: "session_creation" | "delivery";
  outcome?: "success" | "timeout" | "network_error" | "provider_5xx" | "provider_4xx" | "unknown";
  status?: unknown;
  sessionIdKnown?: boolean;
  transactionIdKnown?: boolean;
};

export function decideOnrampRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.status !== undefined && !isDocumentedOnrampStatus(input.status)) {
    return { action: "fail_closed", reason: "The provider status is undocumented; do not retry or mark fulfillment." };
  }
  if (input.operation === "session_creation") {
    if (input.outcome === "timeout" || input.outcome === "network_error" || input.outcome === "unknown") {
      return input.sessionIdKnown
        ? { action: "reconcile_existing_session", reason: "The request may have created a session; reconcile it before another attempt." }
        : { action: "retry_same_idempotency", reason: "Retry only with the same request-bound idempotency key." };
    }
    if (input.outcome === "provider_5xx") return { action: "retry_same_idempotency", reason: "Retry the provider call with the same request-bound idempotency key." };
    if (input.outcome === "provider_4xx") return { action: "do_not_retry", reason: "The provider rejected the request; correct the input or authorization before a new attempt." };
    if (input.status === "rejected") return { action: "do_not_retry", reason: "Stripe rejected the customer; do not create a replacement session automatically." };
    return { action: "await_webhook", reason: "The session exists; wait for the signed status update." };
  }

  if (input.outcome === "timeout" || input.outcome === "network_error" || input.outcome === "unknown") {
    return { action: "reconcile_existing_session", reason: "Delivery state is ambiguous; retrieve and compare the existing session before acting." };
  }
  if (input.status === "fulfillment_complete") {
    return input.transactionIdKnown
      ? { action: "complete", reason: "Signed provider evidence includes fulfillment completion and a transaction identifier." }
      : { action: "reconcile_existing_session", reason: "Completion lacks a transaction identifier; reconcile before claiming delivery." };
  }
  if (input.status === "rejected") return { action: "do_not_retry", reason: "Stripe rejected the customer; no fulfillment or automatic replacement is permitted." };
  return { action: "await_webhook", reason: "Payment or delivery is not complete; wait for the next signed provider update." };
}
