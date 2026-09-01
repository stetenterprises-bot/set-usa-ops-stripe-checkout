# SET Autonomous Purchasing Power Architecture

Status: implementation architecture. This document does not claim that a live payment, wallet, Onramp session, or autonomous transaction has completed.

## Two distinct systems

SET needs two deliberately separate purchasing systems.

### Customer acquisition bridge

This system authenticates a customer, creates or reuses that customer's Privy-owned wallet, and sends the customer into Stripe Onramp. Stripe collects the customer's fiat, performs its required identity and payment checks, buys the selected supported crypto, and delivers it to the confirmed public wallet address.

The customer acquisition bridge may automate intake, validation, quotes, session creation after approval, status reconciliation, delivery evidence, and entitlement release. It must not treat an Onramp approval as authority for a later wallet signature.

### SET execution wallet

This is a separate application-controlled wallet funded with assets owned by SET. It exists so an agent can spend within an approved operating policy without asking for a fresh signature on every qualifying transaction.

Customer money and customer wallets must never be silently moved into this system. A transfer into the SET execution wallet must have an identified owner, source, purpose, ledger entry, and funding authority.

The user's statement that SET has legal-counsel sign-off through the current compliance and risk design is an important project input. Live operation still depends on the selected provider accepting the use case and enabling the required account, wallet, payment, and geographic capabilities.

### Separate execution authorization scope

The legal-counsel sign-off described above is user-stated for the current customer-owned acquisition design. It is not, by itself, an authorization to place application-controlled custody or execution into production. The execution wallet is a separate scope that requires its own written operational boundary, provider terms review, account and geographic enablement, signer/key-service configuration, and release evidence.

The application-owned execution boundary is deny-by-default. The pure evaluator scaffold in `src/execution-policy.ts` accepts an intent only when the intent names the SET capital owner and signing authority, matches an immutable policy version, uses an approved purpose, rail, asset, network, recipient or contract method, remains within per-transaction, daily, and monthly limits, satisfies its approval tier with valid in-window approval timestamps, and has current ownership, signer-health, provider-health, simulation, incident-hold, validity-window, and replay-ledger evidence. Unknown or malformed values deny. The evaluator returns reasons and never signs, submits, or otherwise sends a transaction; those actions belong to a separately governed transaction service after the required provider enablement and approvals.

## Customer acquisition state machine

```text
intake
  -> awaiting_authentication
  -> authenticated
  -> awaiting_wallet
  -> wallet_created | wallet_reused
  -> awaiting_wallet_confirmation
  -> wallet_confirmed
  -> awaiting_quote
  -> quote_ready
  -> awaiting_approval
  -> approved
  -> session_creating
  -> awaiting_customer
  -> payment_processing
  -> fulfillment_processing
  -> fulfillment_complete
```

Provider rejection, cancellation, expiry, and ambiguous responses terminate in explicit failure or reconciliation states. An ambiguous session is reconciled before another session is created.

## SET execution-wallet request

Every autonomous request is normalized into a signed intent:

```json
{
  "intent_id": "opaque server identifier",
  "principal": "SET",
  "purpose": "approved operating purpose",
  "rail": "onchain | mpp | card | bank",
  "asset": "exact asset or fiat currency",
  "maximum_amount": "decimal string",
  "destination": "verified recipient, contract, or merchant",
  "network": "exact network when onchain",
  "valid_after": "timestamp",
  "expires_at": "timestamp",
  "policy_version": "immutable policy version",
  "idempotency_key": "stable business-operation key"
}
```

The agent proposes an intent. It does not directly receive a signing key.

## Policy engine

The execution wallet is default-deny. An intent may execute autonomously only when every condition passes:

- the principal owns the funds;
- the purpose is in the approved purpose registry;
- the rail, asset, network, recipient, and contract are allowlisted;
- the single-transaction, rolling daily, and rolling monthly limits remain available;
- the quote is current and inside maximum price, fee, slippage, and minimum-received bounds;
- contract simulation succeeds and introduces no unapproved approval or call;
- the intent has not expired or already executed;
- the corresponding idempotency key has not been consumed;
- the signer and provider report healthy status;
- no reconciliation or incident hold is active.

Policy failures produce a review item. They never broaden policy automatically.

Example authority tiers:

| Tier | Authority | Example |
|---|---|---|
| A | Autonomous inside policy | Known vendor or contract, allowlisted asset, small amount, current quote |
| B | One additional SET approval | New recipient, elevated amount, new contract method, unusual fee |
| C | Two-party or quorum approval | Treasury transfer, signer-policy change, large amount, new chain |
| D | Prohibited | Private-key export to an agent, unknown contract, policy bypass, customer-fund commingling |

## Signer architecture

The application holds no raw wallet private key in source, logs, environment output, or agent context. Privy authorization keys, server signers, policies, or key quorums authorize narrowly defined wallet actions. Production signer material belongs in provider-managed secure infrastructure or a managed secret/key service and is exposed only to the transaction service.

The transaction service performs:

1. intent schema validation;
2. ownership and budget-ledger checks;
3. current quote retrieval;
4. transaction construction and simulation;
5. policy evaluation;
6. approval routing when required;
7. one-time idempotent submission;
8. provider and chain reconciliation;
9. immutable result and accounting records.

## Rail adapters

An execution wallet does not make every merchant payable.

- `onchain`: transfers, swaps, contract calls, and crypto-native commerce supported by the wallet and policy.
- `mpp`: machine-payable HTTP services supported by SET's MPP implementation.
- `card`: requires a separately approved card-issuing or card-funding provider. Stripe Onramp does not create a debit card.
- `bank`: requires a separately approved bank-payment or payout provider and settlement account.

ChatGPT web subscriptions currently require an accepted subscription payment method such as a credit or debit card. Buying crypto through Onramp alone does not supply that payment credential.

## Durable records

The system persists only non-secret operational evidence:

- request and intent identifiers;
- normalized monetary values as decimal strings;
- authenticated owner/principal references;
- public wallet and provider resource identifiers;
- quote, approval, policy, and idempotency versions;
- provider session and webhook event identifiers;
- submitted transaction hash or provider transaction identifier;
- status transitions, reconciliation attempts, and failure classifications;
- entitlement or accounting outcome.

Secrets, access tokens, client secrets, private keys, seed phrases, raw payment credentials, and full KYC records are excluded.

## Operational claim threshold

SET may describe the local implementation as a tested purchasing-power bridge only after its code and tests pass. SET may describe it as operational only after all of these are evidenced in the target mode:

1. exact Privy application attachment and runtime credentials;
2. authenticated Privy user and user-owned wallet smoke;
3. Stripe Onramp account approval, supported geography, and supported pair;
4. successfully created provider session with a stable idempotency key;
5. customer-completed test or live payment as explicitly authorized;
6. signature-verified webhook delivery;
7. atomic event deduplication and out-of-order reconciliation;
8. recorded fulfillment amount and transaction identifier;
9. recovery-worker handling of an incomplete or ambiguous session;
10. current release matrix with no payment-critical `UNKNOWN` fields.

The autonomous execution-wallet claim additionally requires a funded SET-owned wallet, installed policy, signer health proof, simulation evidence, successful policy-allowed transaction, blocked policy-negative transaction, and reconciled accounting record.
