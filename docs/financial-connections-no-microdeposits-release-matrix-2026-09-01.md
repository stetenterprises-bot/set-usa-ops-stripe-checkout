# SET live release matrix — Financial Connections without microdeposits

Checked: 2026-09-01 America/Chicago

Release source commit before this change: `c5d2cd81ad3874e69e6168dafbf544124347b382`

Scope: the direct SET Checkout flow when a customer selects `us_bank_account` for USD ACH Direct Debit. This matrix records the pre-change state required before replacing Stripe's default Financial Connections-with-microdeposit-fallback behavior with Financial Connections-only instant verification. No deployment or real payment is authorized by this matrix.

## Release gates

| Gate | Current evidence | State |
|---|---|---|
| Source commit | Current checkout source is commit `c5d2cd81ad3874e69e6168dafbf544124347b382`. The worktree already contains unrelated user changes in `.agents/skills/sp-privy/SKILL.md` and `.projects/state.local.json`; this change must not alter them. | VERIFIED LOCAL BASE; WORKTREE DIRTY |
| Public host and routes | `https://set-business-consults-mpp.onrender.com/health`, `/checkout`, and `/checkout/workflow-improvement-review-297-usd/config` returned HTTP 200. Health reported live mode and configured Stripe Checkout/webhook fields. | VERIFIED LIVE PRE-CHANGE |
| Stripe account and mode | Authenticated Stripe CLI reported account `acct_1TTLQF2NmiYTbEIN`, display name `SET Business Consults`, API version `2026-07-29.dahlia`, and live/test credentials available. The public service reported `mode: live`. | VERIFIED LIVE |
| Offers, amounts, currencies | Source currently offers $495 USD, $297 USD, €297 EUR, and open payments from 1.00 to 10,000.00 in USD or EUR. The Financial Connections change applies only when the selected type is `us_bank_account`, which is in the USD allowlist. | VERIFIED SOURCE |
| Account-verified payment-method availability | The authenticated live default Payment Method Configuration `pmc_1TTLQn2NmiYTbEINDkS9EE9N` reported `us_bank_account.available: true` and display value `on`. The other current static allowlist methods also reported available in that configuration. | VERIFIED LIVE ACCOUNT CONFIGURATION |
| Transaction-specific eligibility | Exact ACH eligibility still depends on the final amount, customer and bank location, institution support, account type, Stripe risk controls, and the Financial Connections session result. No buyer context or bank was exercised. | UNKNOWN |
| User-selected static allowlist | USD remains `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`; EUR remains `card`, `bizum`, `eps`, `mb_way`, `multibanco`. This change does not add or remove a payment method. | VERIFIED SOURCE; UNCHANGED |
| Client/server allowlist parity | The client receives the allowlist from the server and the server creates the PaymentIntent with the same allowed types; existing tests cover parity. | VERIFIED SOURCE/TEST PRE-CHANGE |
| Bank-verification policy parity | Neither the deferred Payment Element nor the server PaymentIntent currently specifies `us_bank_account.verification_method`. Stripe therefore uses `automatic`, which is Financial Connections with manual-entry/microdeposit fallback. | VERIFIED SOURCE; DOES NOT MEET REQUEST |
| Proposed no-microdeposit policy | Set `paymentMethodOptions.us_bank_account.verification_method = "instant"` in the deferred Payment Element and `payment_method_options.us_bank_account.verification_method = "instant"` on the server PaymentIntent. | APPLIED LOCALLY |
| Redirect and required action | The browser supplies a return URL and handles PaymentIntent `requires_action`. Financial Connections remains a Stripe-hosted customer action inside the Payment Element. | VERIFIED SOURCE; LIVE BANK FLOW UNKNOWN |
| Asynchronous settlement | Instant verification removes the multi-day microdeposit verification step, but ACH debit settlement itself remains asynchronous. Fulfillment must continue to wait for `payment_intent.succeeded`. | VERIFIED DESIGN; LIVE OUTCOME UNKNOWN |
| Customer object | Current Checkout creates a Stripe Customer only when `customer_balance` is in the offer allowlist, which is true for USD offers. The same Customer is supplied to the PaymentIntent. | VERIFIED SOURCE |
| Partial funding | `customer_balance` bank transfer can be partial; ACH Direct Debit does not use that partial-funding flow. | VERIFIED DESIGN; LIVE OUTCOME UNKNOWN |
| Webhook endpoint and events | Authenticated live Stripe evidence shows enabled endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` at `https://set-business-consults-mpp.onrender.com/webhooks/stripe`, subscribed to PaymentIntent created, requires_action, processing, succeeded, payment_failed, and canceled, plus Onramp updates. | VERIFIED LIVE |
| Durable event deduplication and idempotent fulfillment | PaymentIntent creation uses an idempotency key and the webhook verifies signatures. Checkout fulfillment remains manual and source does not establish durable automated fulfillment for this offer. | PARTIAL; AUTOMATED FULFILLMENT NOT COMPLETE |
| Authenticated smoke outcome | Public health/config routes and authenticated provider configuration were read successfully. No Financial Connections session, bank login, ConfirmationToken, or ACH PaymentIntent was created. | PRE-CHANGE READS VERIFIED; FLOW UNKNOWN |
| Real payment submitted | No real payment, microdeposit, bank login, account connection, or debit was submitted in this verification. | VERIFIED NONE |

## Pre-change decision

The live account can present `us_bank_account`, but the current code does not disable microdeposit fallback. The requested source change is therefore justified. Operational completion must remain unclaimed until the changed client/server policy passes local tests, is deployed, and an explicitly authorized test-mode Financial Connections flow proves that manual account entry is absent. A real live ACH payment remains separately approval-gated.

## Post-change local verification

- The deferred Payment Element now sets `paymentMethodOptions.us_bank_account.verification_method` to `instant`, requests all four current permissions, and prefetches balances, ownership, and transactions.
- The server PaymentIntent now independently sets the same `instant` policy, permission set, and prefetch set while preserving the existing `customer_balance` options.
- The EUR path omits US-bank-account options.
- `npm run verify` passed: secret scan, TypeScript check, 15 test files with 106 passing tests, and production build.
- The authenticated test default Payment Method Configuration `pmc_1TTLQn2NmiYTbEINSfWstBHC` also reported live mode false, `us_bank_account.available: true`, and display value `on`.
- No deployment, Financial Connections session, ConfirmationToken, PaymentIntent, bank authentication, microdeposit, or real payment was created. Authenticated end-to-end smoke and transaction-specific eligibility therefore remain `UNKNOWN`.
