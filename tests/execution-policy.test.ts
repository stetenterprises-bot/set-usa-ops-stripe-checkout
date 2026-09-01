import { describe, expect, it } from "vitest";
import { evaluate, type ExecutionEvaluationContext, type ExecutionIntent, type ExecutionPolicy } from "../src/execution-policy.js";

const policy: ExecutionPolicy = {
  policyVersion: "set-execution-v1",
  capitalOwner: "SET",
  signingAuthority: "set-transaction-service",
  approvedRails: ["onchain", "mpp"],
  approvedAssets: ["usdc"],
  approvedNetworks: ["base"],
  approvedRecipients: ["0xapproved"],
  approvedContracts: [{ address: "0xswap", network: "base", method: "exactInput" }],
  purposes: [{ purpose: "approved-vendor", tier: "A" }, { purpose: "treasury-transfer", tier: "C" }],
  limits: {
    perTransaction: [{ asset: "usdc", amount: "100" }],
    daily: [{ asset: "usdc", amount: "250" }],
    monthly: [{ asset: "usdc", amount: "1000" }]
  },
  approvalTiers: { A: { requiredApprovals: 0 }, B: { requiredApprovals: 1 }, C: { requiredApprovals: 2 }, D: { requiredApprovals: 0 } }
};

const intent: ExecutionIntent = {
  intentId: "intent-unique-1",
  capitalOwner: "SET",
  signingAuthority: "set-transaction-service",
  purpose: "approved-vendor",
  rail: "onchain",
  asset: "USDC",
  maximumAmount: "25.00",
  destination: { kind: "recipient", id: "0xapproved" },
  network: "BASE",
  validAfter: "2026-08-31T12:00:00.000Z",
  expiresAt: "2026-08-31T12:05:00.000Z",
  policyVersion: "set-execution-v1",
  idempotencyKey: "business-op-1"
};

const context: ExecutionEvaluationContext = {
  now: "2026-08-31T12:01:00.000Z",
  fundsOwnershipVerified: true,
  signerHealthy: true,
  providerHealthy: true,
  simulationPassed: true,
  incidentHoldActive: false,
  dailySpent: [{ asset: "usdc", amount: "10" }],
  monthlySpent: [{ asset: "usdc", amount: "100" }],
  consumedIntentIds: [],
  consumedIdempotencyKeys: [],
  approvals: []
};

describe("execution authorization policy", () => {
  it("allows a fully known tier-A intent without signing or sending anything", () => {
    const result = evaluate(policy, intent, context);
    expect(result).toEqual({ allowed: true, requiredTier: "A", reasons: [] });
  });

  it("denies unknown runtime evidence by default", () => {
    const result = evaluate(policy, intent, {});
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "UNKNOWN_NOW", "UNKNOWN_DAILY_SPENT", "UNKNOWN_FUNDS_OWNERSHIP_VERIFIED", "UNKNOWN_SIGNER_HEALTHY",
      "UNKNOWN_MONTHLY_SPENT", "UNKNOWN_PROVIDER_HEALTHY", "UNKNOWN_SIMULATION_PASSED", "UNKNOWN_INCIDENT_HOLD_ACTIVE",
      "UNKNOWN_CONSUMED_INTENT_IDS", "UNKNOWN_CONSUMED_IDEMPOTENCY_KEYS", "UNKNOWN_APPROVALS"
    ]));
  });

  it("blocks replay and mismatched owner, signer, rail, destination, and limits", () => {
    const result = evaluate(policy, {
      ...intent,
      capitalOwner: "customer-wallet",
      signingAuthority: "unknown-signer",
      rail: "card",
      maximumAmount: "101",
      destination: { kind: "recipient", id: "0xunknown" }
    }, { ...context, consumedIntentIds: [intent.intentId] });
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "CAPITAL_OWNER_MISMATCH", "SIGNING_AUTHORITY_MISMATCH", "RAIL_NOT_ALLOWLISTED",
      "RECIPIENT_NOT_ALLOWLISTED", "TRANSACTION_LIMIT_EXCEEDED", "INTENT_REPLAYED"
    ]));
  });

  it("requires the purpose's approval tier and rejects prohibited tier D", () => {
    const result = evaluate(policy, {
      ...intent,
      purpose: "treasury-transfer"
    }, { ...context, approvals: [{ approverId: "one", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: context.now }] });
    expect(result.requiredTier).toBe("C");
    expect(result.reasons.map((reason) => reason.code)).toContain("INSUFFICIENT_APPROVALS");

    const prohibited = evaluate(policy, { ...intent, purpose: "prohibited" }, context);
    expect(prohibited.allowed).toBe(false);
    expect(prohibited.reasons.map((reason) => reason.code)).toContain("PURPOSE_NOT_ALLOWLISTED");
  });

  it("matches contract address, network, and method exactly", () => {
    const allowed = evaluate(policy, { ...intent, destination: { kind: "contract", address: "0xswap", network: "base", method: "exactInput" } }, context);
    expect(allowed.allowed).toBe(true);
    const blocked = evaluate(policy, { ...intent, destination: { kind: "contract", address: "0xswap", network: "base", method: "approve" } }, context);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons.map((reason) => reason.code)).toContain("CONTRACT_NOT_ALLOWLISTED");
  });

  it("is deterministic for the same policy, intent, and evidence", () => {
    expect(evaluate(policy, intent, context)).toEqual(evaluate(policy, intent, context));
  });

  it("enforces the rolling monthly limit", () => {
    const result = evaluate(policy, { ...intent, maximumAmount: "901" }, { ...context, monthlySpent: [{ asset: "usdc", amount: "100" }] });
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain("MONTHLY_LIMIT_EXCEEDED");
  });

  it("fails closed on malformed spend and approval evidence", () => {
    const result = evaluate(policy, intent, {
      ...context,
      dailySpent: [{ asset: "usdc", amount: "not-a-number" }],
      approvals: [{ approverId: "one", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: "not-a-timestamp" }]
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["INVALID_DAILY_SPEND", "INVALID_APPROVALS"]));
  });

  it("does not count approvals outside the intent window or in the future", () => {
    const outside = evaluate(policy, { ...intent, purpose: "treasury-transfer" }, {
      ...context,
      approvals: [
        { approverId: "one", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: "2026-08-31T11:59:00.000Z" },
        { approverId: "two", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: "2026-08-31T12:02:00.000Z" }
      ]
    });
    expect(outside.allowed).toBe(false);
    expect(outside.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["APPROVAL_OUTSIDE_VALIDITY_WINDOW", "INSUFFICIENT_APPROVALS"]));

    const future = evaluate(policy, { ...intent, purpose: "treasury-transfer" }, {
      ...context,
      approvals: [
        { approverId: "one", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: context.now },
        { approverId: "two", intentId: intent.intentId, policyVersion: intent.policyVersion, approvedAt: "2026-08-31T12:02:00.000Z" }
      ],
      now: "2026-08-31T12:01:00.000Z"
    });
    expect(future.allowed).toBe(false);
    expect(future.reasons.map((reason) => reason.code)).toContain("APPROVAL_NOT_YET_VALID");
  });
});
