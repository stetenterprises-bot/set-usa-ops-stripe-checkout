# SET live release matrix — Financial Connections full-data scope

Checked: 2026-09-01 12:21 America/Chicago

Production release commit: `ab61b8e6962d0c69cd5e767141c435bea3e55e19`

Scope: production release of Financial Connections-only instant verification for USD `us_bank_account`, with every currently documented permission (`payment_method`, `balances`, `ownership`, `transactions`), all refreshable prefetch categories (`balances`, `ownership`, `transactions`), and account lifecycle monitoring. No real payment or customer-bank connection was submitted during this release.

## Release gates

| Gate | Current evidence | State |
|---|---|---|
| Source commit | Commit `ab61b8e6962d0c69cd5e767141c435bea3e55e19` was pushed to `origin/release/live-checkout`; local and remote SHA match. Existing unrelated user changes in `.agents/skills/sp-privy/SKILL.md`, `.projects/state.local.json`, and `AGENTS.md` remained outside the release commit. | VERIFIED PUSHED |
| Public host and routes | After Render auto-deploy, `/health`, `/`, `/openapi.json`, `/checkout`, both fixed USD routes, the EUR route, open payment, `/crypto-fiat`, and the private Embedded Onramp route returned HTTP 200. Health reports live mode and all existing Stripe, webhook, database, MPP, Onramp, purchasing, approval, and Privy configuration flags true. | VERIFIED LIVE POST-DEPLOY |
| Stripe account and mode | Authenticated CLI reported `SET Business Consults`, account `acct_1TTLQF2NmiYTbEIN`, and API version `2026-07-29.dahlia`. The public service reports live mode. | VERIFIED LIVE |
| Offers and currencies | Financial Connections applies only to USD Checkout paths containing `us_bank_account`; existing fixed USD and bounded open USD offers remain unchanged. | VERIFIED SOURCE |
| Account-verified method availability | Live default Payment Method Configuration `pmc_1TTLQn2NmiYTbEINDkS9EE9N` reports `us_bank_account.available: true` and display value `on`. | VERIFIED LIVE ACCOUNT CONFIGURATION |
| Financial Connections registration | Authenticated Dashboard reports Financial Connections setup complete. Usage details list Underwriting, Financial Management, Identity Verification, and Money Movement for Individuals and Businesses. | VERIFIED LIVE DASHBOARD |
| Documented permissions | Stripe and the installed SDK expose exactly `payment_method`, `balances`, `ownership`, and `transactions`. | VERIFIED CURRENT DOCUMENTATION/SDK |
| Refreshable/prefetch features | Stripe and the installed SDK expose `balances`, `ownership`, and `transactions` for prefetch/refresh. | VERIFIED CURRENT DOCUMENTATION/SDK |
| Active-account signal | Account activity is the Financial Connections Account `status` (`active`, `inactive`, or `disconnected`), not an additional permission. Refreshes are unavailable while inactive. | VERIFIED CURRENT DOCUMENTATION |
| Transaction-specific eligibility | Exact institution support, account type, customer consent, available data, and payment eligibility cannot be known until a specific customer links an account. | UNKNOWN |
| Static allowlist | USD remains `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`; EUR remains unchanged. | VERIFIED SOURCE; USER SELECTED |
| Client/server parity | Client and server retain the same selected static allowlists. Both set `verification_method: instant`, request `payment_method`, `balances`, `ownership`, and `transactions`, and prefetch `balances`, `ownership`, and `transactions` for USD bank-account flows. EUR has no bank-account options. | VERIFIED SOURCE/TEST; CLIENT ASSET VERIFIED LIVE |
| Verification method | The deployed checkout asset contains `us_bank_account.verification_method: instant` and no `microdeposit` or `verify_with_microdeposits` token. A live visual smoke showed the Financial Connections bank search entry point and no routing-number, account-number, deposit-amount, or descriptor-code field before authentication. A completed sandbox authentication is still required to prove the entire customer flow. | VERIFIED DEPLOYED CONTRACT/ENTRY UI; END-TO-END SANDBOX UNKNOWN |
| Consent scope | Financial Connections will display every requested permission to the customer. No SET-hosted consent copy currently enumerates balances, ownership, and transactions. | STRIPE-HOSTED CONSENT AVAILABLE; SET COPY PENDING |
| Data persistence/use | The checkout has no implemented store or public API for raw Financial Connections balances, ownership, or transactions. This change requests/prefetches data at Stripe but must not expose it from an unauthenticated route or log raw payloads. | VERIFIED ABSENT; DATA REMAINS PROVIDER-HOSTED |
| Webhook endpoint/events | Live endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` is enabled at `/webhooks/stripe` with 21 events: the original seven PaymentIntent/Onramp events plus all 14 current Financial Connections account/authorization lifecycle events. | VERIFIED LIVE READ-BACK |
| Durable event deduplication | The deployed handler uses the shared PostgreSQL-backed atomic event-ID claim. The focused signed-event test now sends the identical Financial Connections event twice and proves the first is handled once while the second returns `duplicate: true` without a second log reaction. Repeating the authenticated sandbox Session creation with the same idempotency key returned the same Session ID. No provider-delivered webhook was replayed. | VERIFIED SOURCE/TEST AND SANDBOX SESSION IDEMPOTENCY; PROVIDER WEBHOOK REPLAY UNKNOWN |
| Fulfillment | ACH settlement remains asynchronous and Checkout fulfillment remains manual. Financial data availability or an active connection must never be treated as payment success. | VERIFIED DESIGN; LIVE OUTCOME UNKNOWN |
| Authenticated smoke | The Stripe CLI is authenticated for SET Business Consults and has current test- and live-mode sessions. A non-live Customer and Financial Connections Session were created successfully with all four permissions and all three prefetch features; retrying the exact Session request with the same idempotency key returned the same Session ID. The local browser checkout has no configured test API/publishable keys, so the customer authentication UI could not be launched. No sandbox Financial Connections Account was linked or refreshed. | SANDBOX SERVER CONTRACT/IDEMPOTENCY VERIFIED; CUSTOMER FLOW BLOCKED |
| Real payment/customer data submitted | No payment, bank login, account link, balance refresh, ownership refresh, transaction refresh, or customer financial data was submitted. | VERIFIED NONE |

## Release decision

The provider account is registered for all four stated Financial Connections purposes and the SDK supports all four permissions. The production source now requests all permissions, prefetches all refreshable data categories, retains `instant` verification, and monitors all current account/authorization lifecycle event types. The release is deployed and the live webhook subscription is complete. Operational end-to-end completeness remains blocked by an authenticated sandbox connection, consented data read-back, refresh-event delivery, and provider-event replay.

## Local application result

- Client and server now request `payment_method`, `balances`, `ownership`, and `transactions`.
- Client and server now prefetch `balances`, `ownership`, and `transactions`.
- `instant` verification remains enforced on both surfaces.
- The generic signature-verified webhook handler now recognizes all current Financial Connections account and authorization lifecycle events, claims them through the durable event-ID store, and logs only account/authorization identifiers, lifecycle status, and supported payment-method types.
- `npm run verify` passed: secret scan, TypeScript, 15 test files with 107 passing tests, and production build.

## Provider subscription result

The initial live endpoint update attempt made no change. Stripe rejected the restricted key because it lacks `webhook_write`; provider request ID `req_cZLe0krg4uMbHl`.

After the user explicitly confirmed the Dashboard expansion, the existing live endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` was updated in Stripe Dashboard without changing its URL, description, metadata, or original seven PaymentIntent/Onramp subscriptions. Dashboard confirmation and an independent live-mode Stripe CLI read-back both show the endpoint enabled and listening to 21 events: the original seven plus all 14 current Financial Connections account and authorization events handled by the local source.

Production deployment completed through Render auto-deploy from commit `ab61b8e6962d0c69cd5e767141c435bea3e55e19`. The deployed asset and public route matrix were independently read back after deployment.

The authenticated sandbox server contract completed: Stripe accepted a non-live Session requesting `balances`, `ownership`, `payment_method`, and `transactions`, with `balances`, `ownership`, and `transactions` prefetch. Repeating the exact request with the same idempotency key returned the same Session ID.

The customer flow did not complete because this checkout has no local test API/publishable keys configured. Stripe's official testing guidance also requires the OAuth/non-OAuth institution, consent, authentication, and account-selection flow to be manually exercised; it does not recommend automating that client authentication UI. Consequently, balance, ownership, transaction retrieval, refresh webhook delivery, and a provider-delivered duplicate replay remain `UNKNOWN`.

No customer bank account was linked, no Financial Connections data was retrieved, and no payment was submitted during this release. The deployed source and initial live UI contain no microdeposit path, but the exact claim “no microdeposit path appeared during a completed sandbox connection” remains unverified until that human-operated sandbox flow is run.
