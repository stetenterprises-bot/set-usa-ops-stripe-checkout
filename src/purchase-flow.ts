import crypto from "node:crypto";
import { z } from "zod";

export const purchaseStates = [
  "intake", "awaiting_authentication", "authenticated", "awaiting_wallet",
  "wallet_created", "wallet_reused", "awaiting_wallet_confirmation", "wallet_confirmed",
  "awaiting_quote", "quote_ready", "awaiting_approval", "approved", "session_creating",
  "awaiting_customer", "payment_processing", "payment_succeeded", "fulfillment_processing",
  "fulfillment_complete", "failed", "rejected", "canceled", "expired",
  "reconciliation_required"
] as const;

export type PurchaseState = (typeof purchaseStates)[number];

const transitions: Readonly<Record<PurchaseState, readonly PurchaseState[]>> = {
  intake: ["awaiting_authentication", "failed"],
  awaiting_authentication: ["authenticated", "failed", "canceled"],
  authenticated: ["awaiting_wallet", "failed"],
  awaiting_wallet: ["wallet_created", "wallet_reused", "failed", "canceled"],
  wallet_created: ["awaiting_wallet_confirmation", "reconciliation_required"],
  wallet_reused: ["awaiting_wallet_confirmation", "reconciliation_required"],
  awaiting_wallet_confirmation: ["wallet_confirmed", "awaiting_wallet", "canceled"],
  wallet_confirmed: ["awaiting_quote", "awaiting_wallet_confirmation"],
  awaiting_quote: ["quote_ready", "failed", "rejected", "reconciliation_required"],
  quote_ready: ["awaiting_approval", "expired", "awaiting_quote"],
  awaiting_approval: ["approved", "expired", "awaiting_quote", "canceled"],
  approved: ["session_creating", "expired", "awaiting_quote"],
  session_creating: ["awaiting_customer", "reconciliation_required", "failed", "expired"],
  awaiting_customer: ["payment_processing", "rejected", "canceled", "expired", "failed"],
  payment_processing: ["payment_succeeded", "fulfillment_processing", "rejected", "canceled", "failed", "reconciliation_required"],
  payment_succeeded: ["fulfillment_processing", "reconciliation_required"],
  fulfillment_processing: ["fulfillment_complete", "failed", "reconciliation_required"],
  fulfillment_complete: [],
  failed: ["awaiting_quote"],
  rejected: [], canceled: [], expired: ["awaiting_quote"],
  reconciliation_required: ["session_creating", "awaiting_customer", "payment_processing", "fulfillment_processing", "fulfillment_complete", "failed", "rejected", "canceled", "expired"]
};

export type TransitionAuthority = "authenticated_customer" | "privy_server" | "stripe_webhook" | "server_reconciliation";

export function assertTransition(from: PurchaseState, to: PurchaseState, authority: TransitionAuthority): void {
  const providerOnly = new Set<PurchaseState>(["payment_processing", "payment_succeeded", "fulfillment_processing", "fulfillment_complete", "rejected"]);
  if (providerOnly.has(to) && authority !== "stripe_webhook" && authority !== "server_reconciliation") {
    throw new Error(`State ${to} requires authoritative provider evidence.`);
  }
  // Stripe does not guarantee webhook ordering. A signature-verified event or
  // server reconciliation may therefore advance an in-flight provider state
  // directly to the provider's later authoritative state.
  const providerInFlight = new Set<PurchaseState>([
    "session_creating", "awaiting_customer", "payment_processing", "payment_succeeded",
    "fulfillment_processing", "reconciliation_required"
  ]);
  if ((authority === "stripe_webhook" || authority === "server_reconciliation") &&
      providerInFlight.has(from) && providerOnly.has(to)) return;
  if (!transitions[from].includes(to)) throw new Error(`Invalid purchase transition: ${from} -> ${to}.`);
  const walletStates = new Set<PurchaseState>(["wallet_created", "wallet_reused"]);
  if (walletStates.has(to) && authority !== "privy_server") throw new Error(`State ${to} requires verified Privy server evidence.`);
}

const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const optionalDecimal = z.union([z.string().regex(decimal), z.null()]);

export const intakeSchema = z.object({
  exact_answers: z.object({
    cryptocurrency: z.string().trim().min(1).max(100),
    cryptocurrency_amount: z.string().trim().min(1).max(100),
    payment: z.string().trim().min(1).max(200),
    post_purchase: z.string().trim().min(1).max(500)
  }),
  destination_asset: z.string().trim().regex(/^[A-Za-z0-9.-]{2,16}$/).transform((v) => v.toLowerCase()),
  destination_network: z.string().trim().regex(/^[A-Za-z0-9.-]{2,32}$/).transform((v) => v.toLowerCase()),
  destination_amount: optionalDecimal,
  source_currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((v) => v.toLowerCase()),
  source_budget: optionalDecimal,
  customer_geography: z.string().trim().min(2).max(100),
  post_purchase_intent: z.enum(["none", "swap", "dex", "dapp", "other"])
}).superRefine((value, context) => {
  if (value.destination_amount === null && value.source_budget === null) {
    context.addIssue({ code: "custom", message: "A destination amount or source budget is required." });
  }
});

export type IntakeInput = z.input<typeof intakeSchema>;
export type NormalizedIntake = z.output<typeof intakeSchema> & { request_id: string; approval_state: "intake" };

export function normalizeIntake(input: IntakeInput): NormalizedIntake {
  const parsed = intakeSchema.parse(input);
  return { request_id: `req_${crypto.randomUUID()}`, ...parsed, approval_state: "intake" };
}

export type ApprovalSnapshot = {
  requestId: string; privyUserId: string; privyWalletId: string; walletAddress: string;
  destinationNetwork: string; destinationAsset: string; sourceAmount: string | null;
  sourceCurrency: string; destinationAmount: string | null; quoteId: string;
  quoteObservedAt: string; quoteExpiresAt: string; sourceTotalAmount: string | null;
  networkFee: string | null; transactionFee: string | null; version: number;
};

export function approvalDigest(snapshot: ApprovalSnapshot, nonce: string, signingKey: string): string {
  return crypto.createHmac("sha256", signingKey).update(JSON.stringify(snapshot)).update("\0").update(nonce).digest("base64url");
}

export function onrampIdempotencyKey(requestId: string, approvalVersion: number): string {
  return `set-onramp-${requestId}-${approvalVersion}`;
}

export function requiresFreshReview(expiresAt: string, now = new Date()): boolean {
  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.valueOf()) || expiry <= now;
}
