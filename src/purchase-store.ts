import crypto from "node:crypto";
import { Pool } from "pg";
import {
  assertTransition,
  type NormalizedIntake,
  type PurchaseState,
  type TransitionAuthority
} from "./purchase-flow.js";

/** The small part of pg used by the purchase store. It also makes the store easy to test. */
type PurchaseQueryResult<T = Record<string, unknown>> = {
  rowCount: number | null;
  rows: readonly T[];
};

type PurchaseQueryExecutor = {
  query: (text: string, values?: readonly unknown[]) => Promise<PurchaseQueryResult>;
};

type PurchaseClient = PurchaseQueryExecutor & { release: () => void };

export type PurchaseDatabase = PurchaseQueryExecutor & {
  /** Present on a real pg Pool; omitted by lightweight test doubles. */
  connect?: () => Promise<PurchaseClient>;
};

export type PurchaseRequestRecord = {
  request_id: string;
  owner_privy_user_id: string | null;
  state: PurchaseState;
  version: number;
  exact_answers: Record<string, unknown>;
  normalized_intake: NormalizedIntake;
  privy_wallet_id: string | null;
  wallet_address: string | null;
  wallet_chain_type: string | null;
  destination_asset: string;
  destination_network: string;
  source_currency: string;
  source_amount: string | null;
  destination_amount: string | null;
  quote_id: string | null;
  quote_expires_at: string | Date | null;
  quote_snapshot: Record<string, unknown> | null;
  quote_fees: Record<string, unknown> | null;
  quote_expiry_source: string | null;
  approval_digest: string | null;
  approval_nonce_hash: string | null;
  approval_consumed_at: string | Date | null;
  onramp_session_id: string | null;
  onramp_mode: "sandbox" | "live";
  provider_status: string | null;
  delivered_amount: string | null;
  transaction_id: string | null;
  entitlement_status: "locked" | "released";
  entitlement_type: string;
  entitlement_released_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type CreatePurchaseRequestInput = {
  requestId: string;
  ownerPrivyUserId?: string | null;
  intake: NormalizedIntake;
  onrampMode: "sandbox" | "live";
};

export type WalletEvidence = {
  privyUserId: string;
  privyWalletId: string;
  walletAddress: string;
  walletChainType: string;
  network: string;
  asset: string;
  nonce: string;
  state: "wallet_created" | "wallet_reused";
};

export type QuoteEvidence = {
  quoteId: string;
  quoteExpiresAt: string;
  sourceAmount: string | null;
  destinationAmount: string | null;
  safeSnapshot?: Record<string, unknown> | null;
  fees?: Record<string, unknown> | null;
  expirySource?: string | null;
};

export type ApprovalEvidence = {
  digest: string;
  nonce: string;
};

export type SessionEvidence = {
  sessionId: string;
  providerStatus?: string | null;
};

export type DeliveryEvidence = {
  providerStatus: string;
  deliveredAmount?: string | null;
  transactionId?: string | null;
};

export type ProviderEvent = {
  eventId: string;
  requestId: string;
  eventType: string;
  signatureVerified: true;
  providerStatus?: string | null;
  safePayload: Record<string, unknown>;
};

export type ReconciliationCandidate = Pick<PurchaseRequestRecord,
  "request_id" | "state" | "version" | "onramp_session_id" | "provider_status" |
  "quote_expires_at" | "updated_at" | "created_at" | "owner_privy_user_id">;

export type RecoveryQueueItem = {
  request_id: string;
  reason: string;
  attempts: number;
  next_attempt_at: string | Date;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
};

export type ApprovalConsumption = {
  consumed: boolean;
  request: PurchaseRequestRecord | null;
};

function nonceHash(nonce: string): string {
  return crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
}

function parameter(values: readonly unknown[]): unknown[] {
  return [...values];
}

function row<T>(result: { rows: readonly T[] }): T | null {
  return result.rows[0] ?? null;
}

function providerState(status: string, transactionId: string | null, deliveredAmount: string | null): PurchaseState {
  const value = status.trim().toLowerCase();
  if (value === "initialized" || value === "requires_payment") return "awaiting_customer";
  if (value === "fulfillment_processing") return "fulfillment_processing";
  if (value === "fulfillment_complete") {
    return transactionId && deliveredAmount?.trim() ? "fulfillment_complete" : "reconciliation_required";
  }
  if (value === "rejected") return "rejected";
  return "reconciliation_required";
}

function providerProgressRank(state: PurchaseState): number | null {
  if (state === "awaiting_customer") return 1;
  if (state === "payment_processing" || state === "payment_succeeded") return 2;
  if (state === "fulfillment_processing") return 3;
  if (state === "fulfillment_complete") return 4;
  return null;
}

function isStaleProviderState(current: PurchaseState, target: PurchaseState): boolean {
  if (["fulfillment_complete", "rejected", "canceled"].includes(current)) return current !== target;
  const currentRank = providerProgressRank(current);
  const targetRank = providerProgressRank(target);
  return currentRank !== null && targetRank !== null && targetRank < currentRank;
}

/**
 * Durable storage for the customer-owned Privy -> Stripe Onramp workflow.
 *
 * The schema is supplied by db/migrations/0001_customer_onramp_flow.sql. This
 * module intentionally does not share the checkout/Stripe-App event tables.
 */
export class PostgresPurchaseStore {
  private readonly database: PurchaseDatabase;
  private readonly recoveryLeaseOwner = `purchase-store-${crypto.randomUUID()}`;

  constructor(connectionStringOrDatabase: string | PurchaseDatabase) {
    this.database = typeof connectionStringOrDatabase === "string"
      ? new Pool({ connectionString: connectionStringOrDatabase, max: 5 })
      : connectionStringOrDatabase;
  }

  async createRequest(input: CreatePurchaseRequestInput): Promise<PurchaseRequestRecord> {
    const intake = input.intake;
    const inserted = await this.database.query(
      `INSERT INTO customer_onramp_requests
       (request_id, owner_privy_user_id, state, version, exact_answers, normalized_intake,
        destination_asset, destination_network, source_currency, source_amount,
        destination_amount, onramp_mode)
       VALUES ($1, $2, 'intake', 1, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (request_id) DO NOTHING
       RETURNING request_id`,
      parameter([
        input.requestId,
        input.ownerPrivyUserId ?? null,
        JSON.stringify(intake.exact_answers),
        JSON.stringify(intake),
        intake.destination_asset,
        intake.destination_network,
        intake.source_currency,
        intake.source_budget,
        intake.destination_amount,
        input.onrampMode
      ])
    );
    if (inserted.rowCount === 1) {
      const created = await this.getRequest(input.requestId);
      if (created) return created;
    }
    const existing = await this.getRequest(input.requestId);
    if (!existing) throw new Error(`Purchase request ${input.requestId} could not be persisted.`);
    return existing;
  }

  async getRequest(requestId: string): Promise<PurchaseRequestRecord | null> {
    return this.getRequestUsing(this.database, requestId);
  }

  private async getRequestUsing(database: PurchaseQueryExecutor, requestId: string): Promise<PurchaseRequestRecord | null> {
    const result = await database.query(
      `SELECT request_id, owner_privy_user_id, state, version, exact_answers, normalized_intake,
              privy_wallet_id, wallet_address, wallet_chain_type, destination_asset,
              destination_network, source_currency, source_amount, destination_amount,
              quote_id, quote_expires_at, quote_snapshot, quote_fees, quote_expiry_source,
              approval_digest, approval_nonce_hash,
              approval_consumed_at, onramp_session_id, onramp_mode, provider_status,
              delivered_amount, transaction_id, entitlement_status, entitlement_type,
              entitlement_released_at, created_at, updated_at
         FROM customer_onramp_requests WHERE request_id = $1`,
      parameter([requestId])
    );
    return row(result) as PurchaseRequestRecord | null;
  }

  async getRequestBySessionId(sessionId: string): Promise<PurchaseRequestRecord | null> {
    const result = await this.database.query(
      `SELECT request_id, owner_privy_user_id, state, version, exact_answers, normalized_intake,
              privy_wallet_id, wallet_address, wallet_chain_type, destination_asset,
              destination_network, source_currency, source_amount, destination_amount,
              quote_id, quote_expires_at, quote_snapshot, quote_fees, quote_expiry_source,
              approval_digest, approval_nonce_hash, approval_consumed_at, onramp_session_id,
              onramp_mode, provider_status, delivered_amount, transaction_id,
              entitlement_status, entitlement_type, entitlement_released_at, created_at, updated_at
         FROM customer_onramp_requests WHERE onramp_session_id = $1`,
      parameter([sessionId])
    );
    return row(result) as PurchaseRequestRecord | null;
  }

  /** Atomic INSERT/ON CONFLICT claim. Only the first verified delivery returns true. */
  async claimEvent(event: ProviderEvent): Promise<boolean> {
    return this.claimEventUsing(this.database, event);
  }

  private async claimEventUsing(database: PurchaseQueryExecutor, event: ProviderEvent): Promise<boolean> {
    const result = await database.query(
      `INSERT INTO customer_onramp_events
       (event_id, request_id, event_type, signature_verified, provider_status, safe_payload)
       VALUES ($1, $2, $3, TRUE, $4, $5::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      parameter([
        event.eventId,
        event.requestId,
        event.eventType,
        event.providerStatus ?? null,
        JSON.stringify(event.safePayload)
      ])
    );
    return result.rowCount === 1;
  }

  async transition(
    requestId: string,
    to: PurchaseState,
    authority: TransitionAuthority,
    expectedVersion?: number
  ): Promise<PurchaseRequestRecord> {
    const current = await this.getRequest(requestId);
    if (!current) throw new Error(`Purchase request ${requestId} was not found.`);
    assertTransition(current.state, to, authority);
    const predicates = expectedVersion === undefined
      ? "request_id = $2"
      : "request_id = $2 AND version = $3";
    const values = expectedVersion === undefined ? [to, requestId] : [to, requestId, expectedVersion];
    const result = await this.database.query(
      `UPDATE customer_onramp_requests SET state = $1, version = version + 1, updated_at = NOW()
       WHERE ${predicates} RETURNING request_id`,
      parameter(values)
    );
    if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    const updated = await this.getRequest(requestId);
    if (!updated) throw new Error(`Purchase request ${requestId} disappeared after update.`);
    return updated;
  }

  /** Bind a request to the first verified Privy user, or return its existing binding. */
  async bindOwner(requestId: string, privyUserId: string): Promise<PurchaseRequestRecord> {
    await this.withTransaction(async (database) => {
      const current = await this.lockedRequest(requestId, database);
      if (!current) throw new Error(`Purchase request ${requestId} was not found.`);
      if (current.owner_privy_user_id !== null && current.owner_privy_user_id !== privyUserId) {
        throw new Error(`Purchase request ${requestId} is owned by a different Privy user.`);
      }
      if (current.owner_privy_user_id === null) {
        const result = await database.query(
          `UPDATE customer_onramp_requests
              SET owner_privy_user_id = $1, updated_at = NOW()
            WHERE request_id = $2 AND owner_privy_user_id IS NULL
            RETURNING request_id`,
          parameter([privyUserId, requestId])
        );
        if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
      }
    });
    const updated = await this.getRequest(requestId);
    if (!updated) throw new Error(`Purchase request ${requestId} disappeared after owner binding.`);
    return updated;
  }

  /** Persist Privy evidence and the user-confirmed wallet atomically. */
  async recordWallet(requestId: string, evidence: WalletEvidence): Promise<PurchaseRequestRecord> {
    await this.withTransaction(async (database) => {
      const current = await this.lockedRequest(requestId, database);
      if (!current) throw new Error(`Purchase request ${requestId} was not found.`);
      if (current.owner_privy_user_id !== null && current.owner_privy_user_id !== evidence.privyUserId) {
        throw new Error(`Purchase request ${requestId} is owned by a different Privy user.`);
      }
      assertTransition(current.state, evidence.state, "privy_server");
      const nextVersion = current.version + 1;
      await database.query(
        `INSERT INTO wallet_confirmations
         (request_id, version, privy_user_id, privy_wallet_id, wallet_address, network, asset, nonce_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        parameter([
          requestId, nextVersion, evidence.privyUserId, evidence.privyWalletId,
          evidence.walletAddress, evidence.network, evidence.asset, nonceHash(evidence.nonce)
        ])
      );
      const requestUpdate = await database.query(
        `UPDATE customer_onramp_requests
            SET owner_privy_user_id = COALESCE(owner_privy_user_id, $1), state = $2, version = version + 1,
                privy_wallet_id = $3, wallet_address = $4, wallet_chain_type = $5, updated_at = NOW()
          WHERE request_id = $6 AND (owner_privy_user_id IS NULL OR owner_privy_user_id = $1)
          RETURNING request_id`,
        parameter([
          evidence.privyUserId, evidence.state, evidence.privyWalletId,
          evidence.walletAddress, evidence.walletChainType, requestId
        ])
      );
      if (requestUpdate.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    });
    const updated = await this.getRequest(requestId);
    if (!updated) throw new Error(`Purchase request ${requestId} disappeared after wallet update.`);
    return updated;
  }

  async recordQuote(requestId: string, quote: QuoteEvidence): Promise<PurchaseRequestRecord> {
    const current = await this.requireRequest(requestId);
    if (current.state !== "quote_ready") assertTransition(current.state, "quote_ready", "server_reconciliation");
    const result = await this.database.query(
      `UPDATE customer_onramp_requests
          SET state = 'quote_ready', version = version + 1, quote_id = $1,
              quote_expires_at = $2, source_amount = $3, destination_amount = $4,
              quote_snapshot = $5::jsonb, quote_fees = $6::jsonb, quote_expiry_source = $7,
              updated_at = NOW()
        WHERE request_id = $8 RETURNING request_id`,
      parameter([
        quote.quoteId, quote.quoteExpiresAt, quote.sourceAmount, quote.destinationAmount,
        quote.safeSnapshot ? JSON.stringify(quote.safeSnapshot) : null,
        quote.fees ? JSON.stringify(quote.fees) : null,
        quote.expirySource ?? null, requestId
      ])
    );
    if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    return this.requireRequest(requestId);
  }

  async recordApproval(requestId: string, approval: ApprovalEvidence): Promise<PurchaseRequestRecord> {
    const current = await this.requireRequest(requestId);
    if (current.state !== "awaiting_approval") assertTransition(current.state, "awaiting_approval", "authenticated_customer");
    const result = await this.database.query(
      `UPDATE customer_onramp_requests
          SET state = 'awaiting_approval', version = version + 1, approval_digest = $1,
              approval_nonce_hash = $2, approval_consumed_at = NULL, updated_at = NOW()
        WHERE request_id = $3 RETURNING request_id`,
      parameter([approval.digest, nonceHash(approval.nonce), requestId])
    );
    if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    return this.requireRequest(requestId);
  }

  /** Expire only pre-session quote states, without touching provider in-flight work. */
  async sweepExpiredQuotes(limit = 100): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const result = await this.database.query(
      `WITH expired AS (
         SELECT request_id
           FROM customer_onramp_requests
          WHERE quote_expires_at IS NOT NULL
            AND quote_expires_at <= NOW()
            AND state IN ('quote_ready', 'awaiting_approval', 'approved')
            AND onramp_session_id IS NULL
          ORDER BY quote_expires_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE customer_onramp_requests AS request
          SET state = 'expired', version = request.version + 1, updated_at = NOW()
         FROM expired
        WHERE request.request_id = expired.request_id
       RETURNING request.request_id`,
      parameter([boundedLimit])
    );
    return result.rowCount ?? result.rows.length;
  }

  /** Compare-and-set approval consumption; a replay gets consumed=false. */
  async consumeApproval(requestId: string, digest: string, nonce: string): Promise<ApprovalConsumption> {
    const result = await this.database.query(
      `UPDATE customer_onramp_requests
          SET state = 'approved', version = version + 1, approval_consumed_at = NOW(), updated_at = NOW()
        WHERE request_id = $1 AND state = 'awaiting_approval' AND approval_digest = $2
          AND approval_nonce_hash = $3 AND approval_consumed_at IS NULL
          AND quote_expires_at IS NOT NULL AND quote_expires_at > NOW()
        RETURNING request_id, owner_privy_user_id, state, version, exact_answers, normalized_intake,
                  privy_wallet_id, wallet_address, wallet_chain_type, destination_asset,
                  destination_network, source_currency, source_amount, destination_amount,
                  quote_id, quote_expires_at, quote_snapshot, quote_fees, quote_expiry_source,
                  approval_digest, approval_nonce_hash,
                  approval_consumed_at, onramp_session_id, onramp_mode, provider_status,
                  delivered_amount, transaction_id, entitlement_status, entitlement_type,
                  entitlement_released_at, created_at, updated_at`,
      parameter([requestId, digest, nonceHash(nonce)])
    );
    return { consumed: result.rowCount === 1, request: row(result) as PurchaseRequestRecord | null };
  }

  async markSessionCreating(requestId: string): Promise<PurchaseRequestRecord> {
    return this.transition(requestId, "session_creating", "authenticated_customer");
  }

  async recordSession(requestId: string, session: SessionEvidence): Promise<PurchaseRequestRecord> {
    let current = await this.requireRequest(requestId);
    // A caller may persist the provider response directly after approval. Keep
    // the intermediate state explicit before recording the returned session.
    if (current.state === "approved") {
      current = await this.markSessionCreating(requestId);
    }
    if (current.state === "awaiting_customer" && current.onramp_session_id === session.sessionId) return current;
    if (current.state !== "session_creating") assertTransition(current.state, "session_creating", "authenticated_customer");
    const result = await this.database.query(
      `UPDATE customer_onramp_requests
          SET state = 'awaiting_customer', version = version + 1, onramp_session_id = $1,
              provider_status = $2, updated_at = NOW()
        WHERE request_id = $3 AND onramp_session_id IS NULL RETURNING request_id`,
      parameter([session.sessionId, session.providerStatus ?? null, requestId])
    );
    if (result.rowCount !== 1) throw new Error(`Onramp session already exists or request ${requestId} changed.`);
    return this.requireRequest(requestId);
  }

  /** Claim and apply one verified provider event in one transaction. */
  async recordDelivery(event: ProviderEvent, delivery: DeliveryEvidence): Promise<{ duplicate: boolean; request: PurchaseRequestRecord | null }> {
    if (!event.signatureVerified) throw new Error("Only signature-verified provider events can be persisted.");
    const result = await this.withTransaction(async (database) => {
      const claimed = await this.claimEventUsing(database, event);
      if (!claimed) {
        return { duplicate: true, request: null };
      }
      const current = await this.lockedRequest(event.requestId, database);
      if (!current) throw new Error(`Purchase request ${event.requestId} was not found.`);
      const transactionId = delivery.transactionId ?? null;
      const target = providerState(delivery.providerStatus, transactionId, delivery.deliveredAmount ?? null);
      if (isStaleProviderState(current.state, target)) {
        await database.query(
          `UPDATE customer_onramp_events SET processed_at = NOW() WHERE event_id = $1`,
          parameter([event.eventId])
        );
        return { duplicate: false, request: current };
      }
      if (target !== current.state) assertTransition(current.state, target, "stripe_webhook");
      const updated = await database.query(
        `UPDATE customer_onramp_requests
            SET state = $1, version = version + 1, provider_status = $2,
                delivered_amount = $3, transaction_id = $4,
                entitlement_status = CASE WHEN $1 = 'fulfillment_complete' THEN 'released' ELSE entitlement_status END,
                entitlement_released_at = CASE WHEN $1 = 'fulfillment_complete' THEN COALESCE(entitlement_released_at, NOW()) ELSE entitlement_released_at END,
                updated_at = NOW()
          WHERE request_id = $5 RETURNING request_id, owner_privy_user_id, state, version, exact_answers,
            normalized_intake, privy_wallet_id, wallet_address, wallet_chain_type, destination_asset,
            destination_network, source_currency, source_amount, destination_amount, quote_id,
            quote_expires_at, quote_snapshot, quote_fees, quote_expiry_source,
            approval_digest, approval_nonce_hash, approval_consumed_at,
            onramp_session_id, onramp_mode, provider_status, delivered_amount, transaction_id,
            entitlement_status, entitlement_type, entitlement_released_at, created_at, updated_at`,
        parameter([target, delivery.providerStatus, delivery.deliveredAmount ?? null, transactionId, event.requestId])
      );
      await database.query(
        `UPDATE customer_onramp_events SET processed_at = NOW() WHERE event_id = $1`,
        parameter([event.eventId])
      );
      return { duplicate: false, request: row(updated) as PurchaseRequestRecord | null };
    });
    if (result.duplicate) return { duplicate: true, request: await this.getRequest(event.requestId) };
    return result;
  }

  async markReconciliationRequired(requestId: string): Promise<PurchaseRequestRecord> {
    const current = await this.requireRequest(requestId);
    if (current.state !== "reconciliation_required") assertTransition(current.state, "reconciliation_required", "server_reconciliation");
    const result = await this.database.query(
      `UPDATE customer_onramp_requests SET state = 'reconciliation_required', version = version + 1, updated_at = NOW()
       WHERE request_id = $1 RETURNING request_id`, parameter([requestId])
    );
    if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    return this.requireRequest(requestId);
  }

  /** Apply provider state retrieved directly by the recovery worker. */
  async recordReconciliation(requestId: string, delivery: DeliveryEvidence): Promise<PurchaseRequestRecord> {
    const current = await this.requireRequest(requestId);
    const transactionId = delivery.transactionId ?? null;
    const target = providerState(delivery.providerStatus, transactionId, delivery.deliveredAmount ?? null);
    if (isStaleProviderState(current.state, target)) return current;
    if (target !== current.state) assertTransition(current.state, target, "server_reconciliation");
    const result = await this.database.query(
      `UPDATE customer_onramp_requests
          SET state = $1, version = version + 1, provider_status = $2,
              delivered_amount = $3, transaction_id = $4,
              entitlement_status = CASE WHEN $1 = 'fulfillment_complete' THEN 'released' ELSE entitlement_status END,
              entitlement_released_at = CASE WHEN $1 = 'fulfillment_complete' THEN COALESCE(entitlement_released_at, NOW()) ELSE entitlement_released_at END,
              updated_at = NOW()
        WHERE request_id = $5 RETURNING request_id`,
      parameter([target, delivery.providerStatus, delivery.deliveredAmount ?? null, transactionId, requestId])
    );
    if (result.rowCount !== 1) throw new Error(`Purchase request ${requestId} changed concurrently.`);
    return this.requireRequest(requestId);
  }

  /** Returns stuck/ambiguous requests for provider status reconciliation and recovery workers. */
  async findReconciliationCandidates(limit = 100): Promise<ReconciliationCandidate[]> {
    const result = await this.database.query(
      `SELECT request_id, owner_privy_user_id, state, version, onramp_session_id,
              provider_status, quote_expires_at, updated_at, created_at
         FROM customer_onramp_requests
        WHERE state = 'reconciliation_required'
           OR state IN ('session_creating', 'payment_processing', 'fulfillment_processing')
        ORDER BY updated_at ASC LIMIT $1`, parameter([limit])
    );
    return [...result.rows] as ReconciliationCandidate[];
  }

  async listRecoverableRequests(limit = 100): Promise<ReconciliationCandidate[]> {
    return this.findReconciliationCandidates(limit);
  }

  async enqueueRecovery(requestId: string, reason: string, lastError?: string | null): Promise<void> {
    await this.database.query(
      `INSERT INTO customer_onramp_recovery_queue (request_id, reason, last_error)
       VALUES ($1, $2, $3)
       ON CONFLICT (request_id) DO UPDATE SET reason = EXCLUDED.reason,
         last_error = EXCLUDED.last_error, updated_at = NOW(), resolved_at = NULL`,
      parameter([requestId, reason.slice(0, 500), lastError?.slice(0, 1_000) ?? null])
    );
  }

  async listDueRecovery(limit = 100): Promise<RecoveryQueueItem[]> {
    return this.claimDueRecovery(limit);
  }

  /** Atomically lease due work so multiple recovery workers cannot claim the same row. */
  async claimDueRecovery(limit = 100, leaseSeconds = 300): Promise<RecoveryQueueItem[]> {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const boundedLease = Math.max(5, Math.min(3_600, Math.floor(leaseSeconds)));
    const result = await this.database.query(
      `WITH due AS (
         SELECT request_id
           FROM customer_onramp_recovery_queue
          WHERE resolved_at IS NULL
            AND next_attempt_at <= NOW()
            AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
          ORDER BY next_attempt_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE customer_onramp_recovery_queue AS queue
          SET lease_owner = $2,
              lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
              updated_at = NOW()
         FROM due
        WHERE queue.request_id = due.request_id
       RETURNING queue.request_id, queue.reason, queue.attempts, queue.next_attempt_at,
                 queue.last_error, queue.created_at, queue.updated_at,
                 queue.lease_owner, queue.lease_expires_at`,
      parameter([boundedLimit, this.recoveryLeaseOwner, boundedLease])
    );
    return [...result.rows] as RecoveryQueueItem[];
  }

  async rescheduleRecovery(requestId: string, error: string, delaySeconds: number): Promise<void> {
    const delay = Math.max(5, Math.min(3_600, Math.floor(delaySeconds)));
    await this.database.query(
      `UPDATE customer_onramp_recovery_queue
          SET attempts = attempts + 1, last_error = $2,
              next_attempt_at = NOW() + ($3 * INTERVAL '1 second'),
              lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE request_id = $1 AND resolved_at IS NULL
          AND (lease_owner IS NULL OR lease_owner = $4)`,
      parameter([requestId, error.slice(0, 1_000), delay, this.recoveryLeaseOwner])
    );
  }

  async resolveRecovery(requestId: string): Promise<void> {
    await this.database.query(
      `UPDATE customer_onramp_recovery_queue
          SET resolved_at = NOW(), lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE request_id = $1 AND resolved_at IS NULL
          AND (lease_owner IS NULL OR lease_owner = $2)`, parameter([requestId, this.recoveryLeaseOwner])
    );
  }

  private async requireRequest(requestId: string): Promise<PurchaseRequestRecord> {
    const result = await this.getRequest(requestId);
    if (!result) throw new Error(`Purchase request ${requestId} was not found.`);
    return result;
  }

  private async lockedRequest(requestId: string, database: PurchaseQueryExecutor = this.database): Promise<PurchaseRequestRecord | null> {
    const result = await database.query(
      `SELECT request_id, owner_privy_user_id, state, version, exact_answers, normalized_intake,
              privy_wallet_id, wallet_address, wallet_chain_type, destination_asset,
              destination_network, source_currency, source_amount, destination_amount,
              quote_id, quote_expires_at, quote_snapshot, quote_fees, quote_expiry_source,
              approval_digest, approval_nonce_hash,
              approval_consumed_at, onramp_session_id, onramp_mode, provider_status,
              delivered_amount, transaction_id, entitlement_status, entitlement_type,
              entitlement_released_at, created_at, updated_at
         FROM customer_onramp_requests WHERE request_id = $1 FOR UPDATE`, parameter([requestId])
    );
    return row(result) as PurchaseRequestRecord | null;
  }

  /** Use one checked-out pg client for a real transaction, while retaining query-only test doubles. */
  private async withTransaction<T>(work: (database: PurchaseQueryExecutor) => Promise<T>): Promise<T> {
    const client = this.database.connect ? await this.database.connect() : null;
    const database = client ?? this.database;
    let began = false;
    try {
      await database.query("BEGIN");
      began = true;
      const result = await work(database);
      await database.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          await database.query("ROLLBACK");
        } catch {
          // Preserve the original transaction error.
        }
      }
      throw error;
    } finally {
      client?.release();
    }
  }
}

export { nonceHash as approvalNonceHash };
