import crypto from "node:crypto";
import type Stripe from "stripe";
import { ZodError } from "zod";
import {
  createIdempotentOnrampSession,
  extractFulfillmentEvidence,
  normalizeSignedOnrampWebhook,
  validateQuoteSnapshot,
  type QuoteSnapshot,
  type RawOnrampClient
} from "./onramp-automation.js";
import { preflightPublicOnrampGeography } from "./onramp-eligibility.js";
import {
  approvalDigest,
  normalizeIntake,
  type ApprovalSnapshot,
  type IntakeInput,
  type PurchaseState
} from "./purchase-flow.js";
import {
  approvalNonceHash,
  PostgresPurchaseStore,
  type PurchaseRequestRecord
} from "./purchase-store.js";
import { PrivyBridgeError, PrivyPurchaseBridge } from "./privy-bridge.js";
import { fetchCurrentOnrampQuote, type CurrentOnrampQuote } from "./stripe-onramp-quote.js";

export type SafePurchaseStatus = {
  requestId: string;
  state: PurchaseState;
  version: number;
  asset: string;
  network: string;
  sourceCurrency: string;
  sourceAmount: string | null;
  destinationAmount: string | null;
  wallet: { id: string; address: string; chainType: string } | null;
  quote: { id: string; expiresAt: string | null; fees: Record<string, unknown> | null; expirySource: string | null } | null;
  sessionId: string | null;
  providerStatus: string | null;
  deliveredAmount: string | null;
  transactionId: string | null;
  entitlement: { status: "locked" | "released"; type: string; releasedAt: string | null };
};

export type PurchaseConstraintReview = {
  providerConstraint: "source_amount" | "destination_amount";
  requestedSourceBudget: string | null;
  requestedDestinationAmount: string | null;
  quotedSourceTotalAmount: string | null;
  estimatedDestinationAmount: string | null;
  withinSourceBudget: boolean | null;
  destinationTargetMatched: boolean | null;
};

export class PurchasingOrchestratorError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PurchasingOrchestratorError";
    this.code = code;
    this.status = status;
  }
}

function error(code: string, message: string, status?: number): never {
  throw new PurchasingOrchestratorError(code, message, status);
}

function dateString(value: string | Date | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function safeStatus(record: PurchaseRequestRecord): SafePurchaseStatus {
  return {
    requestId: record.request_id,
    state: record.state,
    version: record.version,
    asset: record.destination_asset,
    network: record.destination_network,
    sourceCurrency: record.source_currency,
    sourceAmount: record.source_amount,
    destinationAmount: record.destination_amount,
    wallet: record.privy_wallet_id && record.wallet_address && record.wallet_chain_type
      ? { id: record.privy_wallet_id, address: record.wallet_address, chainType: record.wallet_chain_type }
      : null,
    quote: record.quote_id
      ? { id: record.quote_id, expiresAt: dateString(record.quote_expires_at), fees: record.quote_fees, expirySource: record.quote_expiry_source }
      : null,
    sessionId: record.onramp_session_id,
    providerStatus: record.provider_status,
    deliveredAmount: record.delivered_amount,
    transactionId: record.transaction_id,
    entitlement: {
      status: record.entitlement_status ?? "locked",
      type: record.entitlement_type ?? "verified_crypto_delivery",
      releasedAt: dateString(record.entitlement_released_at ?? null)
    }
  };
}

function walletChainType(destinationNetwork: string, requested?: string): string {
  if (destinationNetwork === "ethereum" || destinationNetwork === "base") return "ethereum";
  if (destinationNetwork === "solana") return "solana";
  if (destinationNetwork === "bitcoin") {
    if (requested === "bitcoin-segwit" || requested === "bitcoin-taproot") return requested;
    error("wallet_chain_required", "Choose bitcoin-segwit or bitcoin-taproot before preparing a Bitcoin wallet.");
  }
  error("unsupported_network", "The destination network is not supported by the customer-owned wallet bridge.");
}

function quoteFromRecord(record: PurchaseRequestRecord): QuoteSnapshot {
  const parsed = validateQuoteSnapshot(record.quote_snapshot);
  if (!parsed.ok) error("quote_invalid", parsed.error, 409);
  return parsed.quote;
}

function compareDecimals(left: string | null, right: string | null): -1 | 0 | 1 | null {
  if (left === null || right === null || !/^\d+(?:\.\d+)?$/.test(left) || !/^\d+(?:\.\d+)?$/.test(right)) return null;
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const places = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(places, "0")}`);
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(places, "0")}`);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function walletAddressesMatch(network: string, expected: string, delivered: string | null): boolean {
  if (delivered === null) return false;
  return network === "ethereum" || network === "base"
    ? expected.toLowerCase() === delivered.toLowerCase()
    : expected === delivered;
}

function providerStatusCode(cause: unknown): number | null {
  if (!cause || typeof cause !== "object") return null;
  const direct = (cause as { statusCode?: unknown }).statusCode;
  if (typeof direct === "number" && Number.isInteger(direct)) return direct;
  const raw = (cause as { raw?: { statusCode?: unknown } }).raw?.statusCode;
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

export type PurchasingOrchestratorOptions = {
  store: PostgresPurchaseStore;
  privy: PrivyPurchaseBridge;
  stripe: Pick<Stripe, "rawRequest">;
  approvalSigningKey: string;
  onrampMode: "sandbox" | "live";
  quoteReviewWindowSeconds?: number;
};

export class CustomerPurchasingOrchestrator {
  private readonly store: PostgresPurchaseStore;
  private readonly privy: PrivyPurchaseBridge;
  private readonly stripe: Pick<Stripe, "rawRequest">;
  private readonly approvalSigningKey: string;
  private readonly onrampMode: "sandbox" | "live";
  private readonly quoteReviewWindowSeconds: number;

  constructor(options: PurchasingOrchestratorOptions) {
    if (Buffer.byteLength(options.approvalSigningKey, "utf8") < 32) {
      error("configuration_required", "The purchase approval signing key must contain at least 32 bytes.", 503);
    }
    this.store = options.store;
    this.privy = options.privy;
    this.stripe = options.stripe;
    this.approvalSigningKey = options.approvalSigningKey;
    this.onrampMode = options.onrampMode;
    this.quoteReviewWindowSeconds = options.quoteReviewWindowSeconds ?? 60;
  }

  async createRequest(input: IntakeInput, authorization: string | undefined): Promise<SafePurchaseStatus> {
    const intake = normalizeIntake(input);
    const geography = preflightPublicOnrampGeography(intake.customer_geography);
    if (!geography.eligible) error(geography.code, geography.reason, 422);
    // Normalize and preflight before authentication, but do not persist an
    // unowned public request. The verified Privy subject is its owner at insert.
    const claims = await this.privy.authenticate(authorization);
    const normalized = { ...intake, customer_geography: geography.normalizedGeography };
    const record = await this.store.createRequest({
      requestId: normalized.request_id,
      ownerPrivyUserId: claims.userId,
      intake: normalized,
      onrampMode: this.onrampMode
    });
    return safeStatus(record);
  }

  async getStatus(requestId: string, authorization: string | undefined): Promise<SafePurchaseStatus> {
    const claims = await this.privy.authenticate(authorization);
    const record = await this.requireRequest(requestId);
    if (!record.owner_privy_user_id) error("ownership_unbound", "Authenticate the purchase request through wallet preparation before reading it.", 409);
    if (record.owner_privy_user_id !== claims.userId) error("forbidden", "The purchase request belongs to another user.", 403);
    return safeStatus(record);
  }

  async prepareWallet(input: {
    requestId: string;
    authorization: string | undefined;
    idempotencyKey: string;
    walletChainType?: string;
    reuseConfirmedWalletId?: string;
    createWalletConfirmed?: boolean;
  }): Promise<{ result: Awaited<ReturnType<PrivyPurchaseBridge["prepareWallet"]>>; purchase: SafePurchaseStatus }> {
    const claims = await this.privy.authenticate(input.authorization);
    let record = await this.requireRequest(input.requestId);
    if (record.owner_privy_user_id && record.owner_privy_user_id !== claims.userId) error("forbidden", "The purchase request belongs to another user.", 403);
    try {
      record = await this.store.bindOwner(record.request_id, claims.userId);
    } catch (cause) {
      const latest = await this.requireRequest(record.request_id);
      if (latest.owner_privy_user_id && latest.owner_privy_user_id !== claims.userId) {
        error("forbidden", "The purchase request belongs to another user.", 403);
      }
      throw cause;
    }
    if (record.state === "intake") record = await this.store.transition(record.request_id, "awaiting_authentication", "authenticated_customer");
    if (record.state === "awaiting_authentication") record = await this.store.transition(record.request_id, "authenticated", "authenticated_customer");
    if (record.state === "authenticated") record = await this.store.transition(record.request_id, "awaiting_wallet", "authenticated_customer");
    if (record.state !== "awaiting_wallet") error("invalid_state", `Wallet preparation is unavailable from ${record.state}.`, 409);
    const chainType = walletChainType(record.destination_network, input.walletChainType);
    const result = await this.privy.prepareWallet({
      authorization: input.authorization,
      requestId: record.request_id,
      network: chainType,
      idempotencyKey: input.idempotencyKey,
      ...(input.reuseConfirmedWalletId ? { reuseConfirmedWalletId: input.reuseConfirmedWalletId } : {}),
      ...(input.createWalletConfirmed === true ? { createWalletConfirmed: true } : {})
    });
    if (result.status === "wallet_created" || result.status === "wallet_reused") {
      record = await this.store.recordWallet(record.request_id, {
        privyUserId: result.privyUserId,
        privyWalletId: result.wallet.id,
        walletAddress: result.wallet.address,
        walletChainType: result.wallet.network,
        network: record.destination_network,
        asset: record.destination_asset,
        nonce: crypto.randomUUID(),
        state: result.status
      });
      record = await this.store.transition(record.request_id, "awaiting_wallet_confirmation", "authenticated_customer");
    }
    return { result, purchase: safeStatus(record) };
  }

  async confirmWallet(input: {
    requestId: string;
    authorization: string | undefined;
    walletId: string;
    idempotencyKey: string;
  }): Promise<SafePurchaseStatus> {
    const claims = await this.privy.authenticate(input.authorization);
    const record = await this.requireRequest(input.requestId);
    if (record.owner_privy_user_id !== claims.userId) error("forbidden", "The purchase request belongs to another user.", 403);
    if (record.state !== "awaiting_wallet_confirmation" || !record.privy_wallet_id || !record.wallet_address || !record.wallet_chain_type) {
      error("invalid_state", "A prepared wallet is required before confirmation.", 409);
    }
    const confirmed = await this.privy.prepareWallet({
      authorization: input.authorization,
      requestId: record.request_id,
      network: record.wallet_chain_type,
      idempotencyKey: input.idempotencyKey,
      reuseConfirmedWalletId: input.walletId
    });
    if (confirmed.status !== "wallet_reused" || confirmed.wallet.id !== record.privy_wallet_id || confirmed.wallet.address !== record.wallet_address) {
      error("wallet_mismatch", "The confirmed wallet does not match the prepared wallet.", 409);
    }
    let updated = await this.store.transition(record.request_id, "wallet_confirmed", "authenticated_customer");
    updated = await this.store.transition(record.request_id, "awaiting_quote", "authenticated_customer");
    return safeStatus(updated);
  }

  async prepareQuoteAndApproval(requestId: string, authorization: string | undefined): Promise<{
    purchase: SafePurchaseStatus;
    quote: CurrentOnrampQuote;
    constraintReview: PurchaseConstraintReview;
    approval: { digest: string; nonce: string; version: number; expiresAt: string; walletAddress: string };
  }> {
    const claims = await this.privy.authenticate(authorization);
    let record = await this.requireRequest(requestId);
    if (record.owner_privy_user_id !== claims.userId) error("forbidden", "The purchase request belongs to another user.", 403);
    if (record.state !== "awaiting_quote" || !record.wallet_address || !record.privy_wallet_id) error("invalid_state", "A confirmed wallet is required before quoting.", 409);
    const privyUserId = record.owner_privy_user_id;
    const privyWalletId = record.privy_wallet_id;
    const confirmedWalletAddress = record.wallet_address;
    const requestedSourceBudget = record.normalized_intake.source_budget;
    const requestedDestinationAmount = record.normalized_intake.destination_amount;
    // Stripe accepts one amount constraint. When the customer supplied both a
    // crypto target and a fiat budget, preserve the crypto target as the exact
    // provider constraint and present the resulting all-in fiat total against
    // the budget for the customer's exact approval.
    const constrainDestination = requestedDestinationAmount !== null;
    const currentQuote = await fetchCurrentOnrampQuote(this.stripe, {
      sourceCurrency: record.source_currency,
      sourceAmount: constrainDestination ? null : requestedSourceBudget,
      destinationCurrency: record.destination_asset,
      destinationNetwork: record.destination_network,
      destinationAmount: constrainDestination ? requestedDestinationAmount : null
    }, { reviewWindowSeconds: this.quoteReviewWindowSeconds });
    const approvalVersion = record.version + 1;
    const safeSnapshot = { ...currentQuote.quote, approvalVersion };
    record = await this.store.recordQuote(record.request_id, {
      quoteId: currentQuote.quote.quoteId,
      quoteExpiresAt: currentQuote.quote.expiresAt,
      sourceAmount: currentQuote.quote.sourceAmount,
      destinationAmount: currentQuote.quote.destinationAmount,
      safeSnapshot,
      fees: { ...currentQuote.fees, sourceTotalAmount: currentQuote.sourceTotalAmount, estimatedSourceAmount: currentQuote.estimatedSourceAmount, estimatedDestinationAmount: currentQuote.estimatedDestinationAmount },
      expirySource: currentQuote.expirySource
    });
    const nonce = crypto.randomBytes(32).toString("base64url");
    const snapshot: ApprovalSnapshot = {
      requestId: record.request_id,
      privyUserId,
      privyWalletId,
      walletAddress: confirmedWalletAddress,
      destinationNetwork: record.destination_network,
      destinationAsset: record.destination_asset,
      sourceAmount: currentQuote.quote.sourceAmount,
      sourceCurrency: record.source_currency,
      destinationAmount: currentQuote.quote.destinationAmount,
      quoteId: currentQuote.quote.quoteId,
      quoteObservedAt: currentQuote.quote.observedAt,
      quoteExpiresAt: currentQuote.quote.expiresAt,
      sourceTotalAmount: currentQuote.sourceTotalAmount,
      networkFee: currentQuote.fees.networkFee,
      transactionFee: currentQuote.fees.transactionFee,
      version: approvalVersion
    };
    const digest = approvalDigest(snapshot, nonce, this.approvalSigningKey);
    record = await this.store.recordApproval(record.request_id, { digest, nonce });
    return {
      purchase: safeStatus(record),
      quote: currentQuote,
      constraintReview: {
        providerConstraint: constrainDestination ? "destination_amount" : "source_amount",
        requestedSourceBudget,
        requestedDestinationAmount,
        quotedSourceTotalAmount: currentQuote.sourceTotalAmount,
        estimatedDestinationAmount: currentQuote.estimatedDestinationAmount,
        withinSourceBudget: requestedSourceBudget === null || currentQuote.sourceTotalAmount === null
          ? null
          : compareDecimals(currentQuote.sourceTotalAmount, requestedSourceBudget) !== 1,
        destinationTargetMatched: requestedDestinationAmount === null || currentQuote.estimatedDestinationAmount === null
          ? null
          : compareDecimals(currentQuote.estimatedDestinationAmount, requestedDestinationAmount) === 0
      },
      approval: { digest, nonce, version: approvalVersion, expiresAt: currentQuote.quote.expiresAt, walletAddress: confirmedWalletAddress }
    };
  }

  async approveAndCreateSession(input: {
    requestId: string;
    authorization: string | undefined;
    digest: string;
    nonce: string;
    customerIp?: string;
    budgetOverageConfirmed?: boolean;
  }): Promise<{ purchase: SafePurchaseStatus; clientSecret: string; sessionId: string }> {
    const claims = await this.privy.authenticate(input.authorization);
    let record = await this.requireRequest(input.requestId);
    if (record.owner_privy_user_id !== claims.userId) error("forbidden", "The purchase request belongs to another user.", 403);
    if (!record.wallet_address || !record.quote_snapshot || !record.approval_digest || !record.approval_nonce_hash) error("invalid_state", "A wallet and approval packet are required.", 409);
    const requestedBudget = record.normalized_intake.source_budget;
    const quotedTotal = typeof record.quote_fees?.sourceTotalAmount === "string"
      ? record.quote_fees.sourceTotalAmount
      : null;
    if (compareDecimals(quotedTotal, requestedBudget) === 1 && input.budgetOverageConfirmed !== true) {
      error("budget_overage_confirmation_required", "The all-in quoted fiat total exceeds the original budget and requires explicit confirmation.", 409);
    }
    const confirmedWalletAddress = record.wallet_address;
    if (record.state === "awaiting_approval") {
      const consumed = await this.store.consumeApproval(record.request_id, input.digest, input.nonce);
      if (!consumed.consumed || !consumed.request) error("approval_invalid", "The approval is invalid, expired, or already consumed.", 409);
      record = consumed.request;
    } else {
      const retryable = ["approved", "session_creating", "reconciliation_required", "awaiting_customer"].includes(record.state);
      if (!retryable || record.approval_digest !== input.digest || record.approval_nonce_hash !== approvalNonceHash(input.nonce) || !record.approval_consumed_at) {
        error("approval_invalid", "The approval is invalid or unavailable for an idempotent retry.", 409);
      }
      if (record.onramp_session_id) {
        if (record.state !== "awaiting_customer") error("session_exists", "This approval already has an Onramp session that is no longer awaiting customer action.", 409);
        try {
          const response = await this.stripe.rawRequest("GET", `/v1/crypto/onramp_sessions/${encodeURIComponent(record.onramp_session_id)}`, {});
          const session = response.data && typeof response.data === "object"
            ? response.data as Record<string, unknown>
            : null;
          if (!session || session.id !== record.onramp_session_id || typeof session.client_secret !== "string" ||
              session.livemode !== (record.onramp_mode === "live")) {
            throw new Error("Stripe returned an invalid existing Onramp session.");
          }
          await this.store.resolveRecovery(record.request_id);
          return { purchase: safeStatus(record), clientSecret: session.client_secret, sessionId: record.onramp_session_id };
        } catch (cause) {
          await this.store.enqueueRecovery(record.request_id, "existing_session_resume_failed", cause instanceof Error ? cause.message : null);
          error("session_resume_failed", "The existing Onramp session could not be safely resumed and was queued for reconciliation.", 503);
        }
      }
    }
    const stored = record.quote_snapshot as Record<string, unknown>;
    const approvalVersion = stored.approvalVersion;
    if (!Number.isSafeInteger(approvalVersion) || (approvalVersion as number) < 1) error("approval_invalid", "The approval version is missing.", 409);
    const quote = quoteFromRecord(record);
    if (record.state === "approved" || record.state === "reconciliation_required") {
      record = await this.store.transition(record.request_id, "session_creating", "authenticated_customer");
    }
    try {
      const created = await createIdempotentOnrampSession(this.stripe as unknown as RawOnrampClient, {
        requestId: record.request_id,
        approvalVersion: approvalVersion as number,
        walletAddress: confirmedWalletAddress,
        quote,
        ...(input.customerIp ? { customerIp: input.customerIp } : {})
      });
      if (!created.session.client_secret) error("provider_response_invalid", "Stripe returned no Onramp client secret.", 502);
      record = await this.store.recordSession(record.request_id, { sessionId: created.session.id, providerStatus: created.session.status });
      await this.store.resolveRecovery(record.request_id);
      return { purchase: safeStatus(record), clientSecret: created.session.client_secret, sessionId: created.session.id };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Onramp session creation failed.";
      if (message.toLowerCase().includes("expired")) {
        await this.store.transition(record.request_id, "expired", "authenticated_customer");
        error("quote_expired", "The quote expired before the Onramp session was created.", 409);
      }
      const statusCode = providerStatusCode(cause);
      if (statusCode !== null && statusCode >= 400 && statusCode < 500 && ![408, 409, 429].includes(statusCode)) {
        await this.store.transition(record.request_id, "failed", "server_reconciliation");
        error("provider_rejected", "Stripe rejected the Onramp session request; the input or account capability must be corrected before a new quote.", 422);
      }
      await this.store.markReconciliationRequired(record.request_id);
      await this.store.enqueueRecovery(record.request_id, "ambiguous_session_creation", message);
      error("session_creation_ambiguous", "Onramp session creation is ambiguous and has been queued for reconciliation.", 503);
    }
  }

  async processSignedWebhook(payload: Buffer, signature: string | undefined, secret: string): Promise<{ duplicate: boolean; purchase: SafePurchaseStatus }> {
    const normalized = normalizeSignedOnrampWebhook(payload, signature, secret);
    if (!normalized.ok) error(normalized.code, normalized.error, normalized.code === "invalid_signature" ? 400 : 422);
    const record = await this.store.getRequestBySessionId(normalized.event.sessionId);
    if (!record) error("session_not_found", "The signed Onramp session is not attached to a purchase request.", 503);
    const expectedLivemode = record.onramp_mode === "live";
    if (normalized.event.livemode === null || normalized.event.livemode !== expectedLivemode) {
      error("mode_mismatch", "The signed Onramp event mode does not match the purchase request.", 422);
    }
    const fulfillment = normalized.event.fulfillment;
    const completeEvidenceMatches = fulfillment.kind === "complete" &&
      fulfillment.destinationCurrency?.toLowerCase() === record.destination_asset &&
      fulfillment.destinationNetwork?.toLowerCase() === record.destination_network &&
      Boolean(record.wallet_address) &&
      walletAddressesMatch(record.destination_network, record.wallet_address as string, fulfillment.walletAddress);
    const delivery = {
      providerStatus: normalized.event.status,
      ...(completeEvidenceMatches ? { deliveredAmount: fulfillment.deliveredAmount, transactionId: fulfillment.transactionId } : {})
    };
    const result = await this.store.recordDelivery({
      eventId: normalized.event.eventId,
      requestId: record.request_id,
      eventType: normalized.event.eventType,
      signatureVerified: true,
      providerStatus: normalized.event.status,
      safePayload: {
        sessionId: normalized.event.sessionId,
        status: normalized.event.status,
        fulfillmentKind: fulfillment.kind,
        evidenceMatchesConfirmedDestination: fulfillment.kind === "complete" ? completeEvidenceMatches : null,
        ...(fulfillment.kind === "complete" ? { transactionId: fulfillment.transactionId, deliveredAmount: fulfillment.deliveredAmount } : {})
      }
    }, delivery);
    if (!result.request) error("persistence_failed", "The Onramp event was claimed without a resulting purchase record.", 503);
    if (result.request.state === "reconciliation_required") {
      await this.store.enqueueRecovery(result.request.request_id, "webhook_requires_reconciliation");
    } else if (result.request.state === "fulfillment_complete" || result.request.state === "rejected") {
      await this.store.resolveRecovery(result.request.request_id);
    }
    return { duplicate: result.duplicate, purchase: safeStatus(result.request) };
  }

  async runRecovery(limit = 25): Promise<{ expiredQuotes: number; examined: number; resolved: number; deferred: number }> {
    const expiredQuotes = await this.store.sweepExpiredQuotes(limit);
    const candidates = await this.store.listDueRecovery(limit);
    let resolved = 0;
    let deferred = 0;
    for (const queued of candidates) {
      const record = await this.requireRequest(queued.request_id);
      if (!record.onramp_session_id) {
        await this.store.rescheduleRecovery(record.request_id, "No provider session ID is available; retry the original approval with the same idempotency key.", 60);
        deferred += 1;
        continue;
      }
      try {
        const response = await this.stripe.rawRequest("GET", `/v1/crypto/onramp_sessions/${encodeURIComponent(record.onramp_session_id)}`, {});
        const providerSession = response.data && typeof response.data === "object"
          ? response.data as Record<string, unknown>
          : null;
        const expectedLivemode = record.onramp_mode === "live";
        if (!providerSession || providerSession.livemode !== expectedLivemode) {
          await this.store.rescheduleRecovery(record.request_id, "Provider session mode is missing or does not match the request.", 300);
          deferred += 1;
          continue;
        }
        const evidence = extractFulfillmentEvidence(response.data);
        if (evidence.kind === "fail_closed" || evidence.kind === "reconciliation_required") {
          await this.store.rescheduleRecovery(record.request_id, evidence.reason, 60);
          deferred += 1;
          continue;
        }
        if (evidence.kind === "complete" && (
          evidence.destinationCurrency?.toLowerCase() !== record.destination_asset ||
          evidence.destinationNetwork?.toLowerCase() !== record.destination_network ||
          !record.wallet_address ||
          !walletAddressesMatch(record.destination_network, record.wallet_address, evidence.walletAddress)
        )) {
          await this.store.rescheduleRecovery(record.request_id, "Provider fulfillment does not match the confirmed asset, network, and wallet.", 300);
          deferred += 1;
          continue;
        }
        const updated = await this.store.recordReconciliation(record.request_id, {
          providerStatus: evidence.status,
          ...(evidence.kind === "complete" ? { deliveredAmount: evidence.deliveredAmount, transactionId: evidence.transactionId } : {})
        });
        if (updated.state === "fulfillment_complete" || updated.state === "rejected") {
          await this.store.resolveRecovery(record.request_id);
          resolved += 1;
        } else {
          await this.store.rescheduleRecovery(record.request_id, `Provider remains ${updated.provider_status ?? updated.state}.`, 60);
          deferred += 1;
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Provider reconciliation failed.";
        await this.store.rescheduleRecovery(record.request_id, message, Math.min(3_600, 30 * 2 ** Math.min(queued.attempts, 6)));
        deferred += 1;
      }
    }
    return { expiredQuotes, examined: candidates.length, resolved, deferred };
  }

  private async requireRequest(requestId: string): Promise<PurchaseRequestRecord> {
    if (!/^req_[A-Za-z0-9_-]+$/.test(requestId)) error("invalid_request", "A valid purchase request ID is required.");
    const record = await this.store.getRequest(requestId);
    if (!record) error("not_found", "The purchase request was not found.", 404);
    return record;
  }
}

export function asPurchasingError(cause: unknown): PurchasingOrchestratorError {
  if (cause instanceof PurchasingOrchestratorError) return cause;
  if (cause instanceof PrivyBridgeError) return new PurchasingOrchestratorError(cause.code, cause.message, cause.status);
  if (cause instanceof ZodError) return new PurchasingOrchestratorError("invalid_request", "The purchase request is invalid.", 400);
  return new PurchasingOrchestratorError("internal_error", "The purchasing operation failed.", 500);
}
