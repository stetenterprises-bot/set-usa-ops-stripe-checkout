# SET live release matrix — Agentic Commerce Readiness Assessment

Checked: 2026-09-01 America/Chicago

Release source commit: `c5c9ad3` on `release/live-checkout`

Scope: the $0.50 machine-readable Agentic Commerce Readiness Assessment and related payment/recovery controls. The $495 human review, customer Privy wallet creation, Stripe Onramp customer payment/KYC, and SET execution-wallet execution remain separate.

## Release gates

| Gate | Current evidence | State |
|---|---|---|
| Source commit | Exact release source is `c5c9ad3`; local verification passed before commit. | VERIFIED SOURCE; LIVE DEPLOY PENDING |
| Public host/routes | Pre-release checks returned HTTP 200 for `/health`, `/`, `/openapi.json`, `/checkout`, and `/crypto-fiat` at `https://set-business-consults-mpp.onrender.com`. Those responses still described the preceding generic MPP artifact. | VERIFIED PRE-RELEASE; POST-DEPLOY PENDING |
| Stripe project/account/mode | Stripe Projects reported project `project_61V...`, account `acct_1TTLQF2NmiYTbEIN`, production environment, completed Render service/database, and completed Privy resources. Public `/health` reported live mode with Stripe, MPP, Onramp, purchasing, webhook, database, and approval configuration present. | VERIFIED CONFIGURATION |
| Offers/currencies | Assessment: $0.50 USD. Human review: $495 USD. Other source offers remain $297 USD, €297 EUR, and bounded open USD/EUR payment. | VERIFIED SOURCE |
| Account-verified payment methods | A new authenticated account capability snapshot was not collected for this release. | UNKNOWN |
| Transaction-specific eligibility | Exact eligibility depends on amount, currency, customer location, Stripe product, confirmation/return flow, account approval, and provider risk/KYC. No customer transaction was attempted. | UNKNOWN |
| Selected static allowlist | USD: `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`. EUR: `card`, `bizum`, `eps`, `mb_way`, `multibanco`. Apple Pay and Google Pay are wallets presented through `card`. | VERIFIED SOURCE; USER SELECTION PREVIOUSLY RECORDED |
| Client/server parity | Checkout client consumes server configuration and the PaymentIntent uses the same offer allowlist; tests cover USD/EUR lists. | VERIFIED SOURCE/TEST |
| Redirect and required action | Client supplies the checkout return URL and handles `requires_action`; return route exists. | VERIFIED SOURCE; LIVE TRANSACTION UNKNOWN |
| Asynchronous settlement | ACH debit and customer-balance bank transfer may remain asynchronous; webhook lifecycle handling exists. | VERIFIED SOURCE; LIVE SETTLEMENT UNKNOWN |
| Customer object | Customer-balance flow creates an idempotent Stripe Customer; other direct flows do not require one. | VERIFIED SOURCE; LIVE BEHAVIOR UNKNOWN |
| Partial funding | Customer-balance bank transfer can be partial/asynchronous. No funding outcome was exercised. | UNKNOWN |
| Webhook endpoint/events | Source verifies raw-body signatures and handles six PaymentIntent lifecycle events plus `crypto.onramp_session.updated`. Prior provider evidence identified the live endpoint, but no new provider subscription snapshot was collected. | VERIFIED SOURCE; CURRENT PROVIDER SNAPSHOT UNKNOWN |
| Durable deduplication/idempotency | Assessment persistence binds logical request, request hash, receipt reference, artifact hash, fulfillment status, and retry state. A client idempotency key returns the original artifact; receipt-first recovery reconciles before another payment. Onramp and Checkout also use idempotency/deduplication controls. | VERIFIED SOURCE/TEST; LIVE DATABASE BEHAVIOR PENDING |
| Assessment semantics | Versioned schema/ruleset, normalized input, ten deterministic control domains, provenance-separated findings, disposition, blockers, activation sequence, receipt reference, and fulfillment timestamp are implemented. Declared capability alone cannot produce a fully verified disposition. | VERIFIED SOURCE/TEST |
| Fulfillment | Assessment fulfillment is machine-generated and persisted after receipt verification. The $495 review remains human; Checkout fulfillment remains manual; Onramp delivery requires verified provider evidence. | VERIFIED SOURCE; LIVE FULFILLMENT PENDING |
| Recovery/reconciliation | Assessment has receipt-first recovery and persistent retry state; purchasing source has leases/reconciliation/recovery. | VERIFIED SOURCE/TEST; LIVE INCIDENT UNKNOWN |
| Local release verification | `npm run verify` passed: secret scan, TypeScript, 15 test files/105 tests, and production build. `npm audit --omit=dev` reported zero production dependency vulnerabilities. | VERIFIED |
| Authenticated smoke | No authenticated live assessment payment, Privy token, Onramp quote/session, signed webhook delivery, or recovery incident was executed. | UNKNOWN / NOT RUN |
| Real payment submitted | No real payment, KYC, wallet creation, Onramp session, blockchain transaction, or SET wallet signature was submitted. | VERIFIED NONE |

## Release decision

The source is locally releasable, but operational completeness cannot be claimed while account-level method availability, transaction-specific eligibility, post-deploy route behavior, live database fulfillment, and authenticated provider flows remain unknown. Deployment of this commit does not authorize a real payment, KYC flow, wallet creation, provider session, or SET execution-wallet transaction.

## Required post-deploy evidence

1. Confirm Render deployed the exact release branch revision and recheck every public route.
2. Confirm `/openapi.json` and `/` expose the versioned readiness-assessment contract and `$0.50` readiness-assessment unit.
3. Exercise a non-paid validation/idempotency smoke without creating a charge.
4. Separately authorize any real-payment test, then verify receipt recovery, duplicate-request behavior, durable fulfillment, webhook delivery, and reconciliation before claiming proven monetary operation.
