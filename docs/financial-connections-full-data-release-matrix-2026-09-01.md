# SET live release matrix — Financial Connections full-data scope

Checked: 2026-09-01 America/Chicago

Release source commit before this expansion: `c5d2cd81ad3874e69e6168dafbf544124347b382`

Scope: expand the USD `us_bank_account` Financial Connections collection request from the base `payment_method` permission to every currently documented permission (`payment_method`, `balances`, `ownership`, `transactions`), prefetch all refreshable data categories (`balances`, `ownership`, `transactions`), and monitor whether linked accounts remain active. This matrix records the required pre-change state. It authorizes no payment or customer-bank connection.

## Release gates

| Gate | Current evidence | State |
|---|---|---|
| Source commit | Current base commit is `c5d2cd81ad3874e69e6168dafbf544124347b382`. Existing unrelated user changes in `.agents/skills/sp-privy/SKILL.md` and `.projects/state.local.json` remain outside this scope. | VERIFIED LOCAL BASE; WORKTREE DIRTY |
| Public host and routes | Live `/health` and `/checkout/workflow-improvement-review-297-usd/config` returned HTTP 200. Health reports live mode with Stripe Checkout and webhook configuration present. | VERIFIED LIVE PRE-CHANGE |
| Stripe account and mode | Authenticated CLI reported `SET Business Consults`, account `acct_1TTLQF2NmiYTbEIN`, and API version `2026-07-29.dahlia`. The public service reports live mode. | VERIFIED LIVE |
| Offers and currencies | Financial Connections applies only to USD Checkout paths containing `us_bank_account`; existing fixed USD and bounded open USD offers remain unchanged. | VERIFIED SOURCE |
| Account-verified method availability | Live default Payment Method Configuration `pmc_1TTLQn2NmiYTbEINDkS9EE9N` reports `us_bank_account.available: true` and display value `on`. | VERIFIED LIVE ACCOUNT CONFIGURATION |
| Financial Connections registration | Authenticated Dashboard reports Financial Connections setup complete. Usage details list Underwriting, Financial Management, Identity Verification, and Money Movement for Individuals and Businesses. | VERIFIED LIVE DASHBOARD |
| Documented permissions | Stripe and the installed SDK expose exactly `payment_method`, `balances`, `ownership`, and `transactions`. | VERIFIED CURRENT DOCUMENTATION/SDK |
| Refreshable/prefetch features | Stripe and the installed SDK expose `balances`, `ownership`, and `transactions` for prefetch/refresh. | VERIFIED CURRENT DOCUMENTATION/SDK |
| Active-account signal | Account activity is the Financial Connections Account `status` (`active`, `inactive`, or `disconnected`), not an additional permission. Refreshes are unavailable while inactive. | VERIFIED CURRENT DOCUMENTATION |
| Transaction-specific eligibility | Exact institution support, account type, customer consent, available data, and payment eligibility cannot be known until a specific customer links an account. | UNKNOWN |
| Static allowlist | USD remains `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`; EUR remains unchanged. | VERIFIED SOURCE; USER SELECTED |
| Client/server parity | Existing source passes matching payment-method types to deferred Elements and the server PaymentIntent. The current Financial Connections permission list is only `payment_method` on both surfaces. | VERIFIED SOURCE; EXPANSION PENDING |
| Verification method | Both local surfaces set `us_bank_account.verification_method` to `instant`, disabling manual-entry/microdeposit fallback. The public deployment still reflects the earlier source until deployment. | VERIFIED LOCAL; LIVE DEPLOYMENT UNKNOWN |
| Consent scope | Financial Connections will display every requested permission to the customer. No SET-hosted consent copy currently enumerates balances, ownership, and transactions. | STRIPE-HOSTED CONSENT AVAILABLE; SET COPY PENDING |
| Data persistence/use | The checkout has no implemented store or public API for raw Financial Connections balances, ownership, or transactions. This change requests/prefetches data at Stripe but must not expose it from an unauthenticated route or log raw payloads. | VERIFIED ABSENT; DATA REMAINS PROVIDER-HOSTED |
| Webhook endpoint/events | Live endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` is enabled at `/webhooks/stripe` for PaymentIntent and Onramp events only. It does not yet subscribe to Financial Connections account lifecycle or refresh events. | VERIFIED LIVE; EXPANSION PENDING |
| Durable event deduplication | The shared event store can atomically claim handled Stripe event IDs. New lifecycle events can use the same mechanism without logging financial payloads. | VERIFIED SOURCE/TEST |
| Fulfillment | ACH settlement remains asynchronous and Checkout fulfillment remains manual. Financial data availability or an active connection must never be treated as payment success. | VERIFIED DESIGN; LIVE OUTCOME UNKNOWN |
| Authenticated smoke | Provider settings, method configuration, webhook configuration, and public routes were read successfully. No Financial Connections Account was linked or refreshed. | READS VERIFIED; CUSTOMER FLOW UNKNOWN |
| Real payment/customer data submitted | No payment, bank login, account link, balance refresh, ownership refresh, transaction refresh, or customer financial data was submitted. | VERIFIED NONE |

## Pre-change decision

The provider account is registered for all four stated Financial Connections purposes and the SDK supports all four permissions. The source can therefore request all permissions and prefetch all refreshable data categories while retaining `instant` verification. To make account activity operationally visible, the webhook handler and live subscription must add created, deactivated, reactivated, disconnected, upcoming-deactivation, expected-deactivation-date, and refreshed-data events. Operational completeness remains blocked by an authenticated sandbox connection and post-deployment verification.

## Local application result

- Client and server now request `payment_method`, `balances`, `ownership`, and `transactions`.
- Client and server now prefetch `balances`, `ownership`, and `transactions`.
- `instant` verification remains enforced on both surfaces.
- The generic signature-verified webhook handler now recognizes all current Financial Connections account and authorization lifecycle events, claims them through the durable event-ID store, and logs only account/authorization identifiers, lifecycle status, and supported payment-method types.
- `npm run verify` passed: secret scan, TypeScript, 15 test files with 107 passing tests, and production build.

## Provider subscription result

The initial live endpoint update attempt made no change. Stripe rejected the restricted key because it lacks `webhook_write`; provider request ID `req_cZLe0krg4uMbHl`.

After the user explicitly confirmed the Dashboard expansion, the existing live endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` was updated in Stripe Dashboard without changing its URL, description, metadata, or original seven PaymentIntent/Onramp subscriptions. Dashboard confirmation and an independent live-mode Stripe CLI read-back both show the endpoint enabled and listening to 21 events: the original seven plus all 14 current Financial Connections account and authorization events handled by the local source.

Source deployment and an authenticated Financial Connections sandbox flow remain pending. No customer bank account was linked, no Financial Connections data was retrieved, and no payment was submitted during the subscription change.
