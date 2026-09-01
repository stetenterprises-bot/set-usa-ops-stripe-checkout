# SET live purchasing release matrix

Checked: 2026-08-31 America/Chicago (final verification after 21:00 CDT)
Scope: customer-owned Privy wallet acquisition through Stripe Embedded Onramp, plus the separately scoped SET execution-wallet architecture.
Decision rule: a deployed/configured control is not evidence that a real customer payment, KYC flow, wallet operation, or blockchain delivery has completed.

## Current matrix

| Gate | Current evidence | State |
|---|---|---|
| Source and deployment | `release/live-checkout` commits `a9daf63`, `cd2adbf`, `db7ca5e`, and `e1e64dd` were pushed. Render auto-deploy remains enabled for the branch and the public behavior from the final commits is live. | VERIFIED LIVE |
| Public host | `https://set-business-consults-mpp.onrender.com` returned 200 for `/health`, `/`, `/openapi.json`, `/checkout`, and `/crypto-fiat`. | VERIFIED LIVE |
| Runtime readiness | Public `/health` reports live mode and `stripeConfigured`, `cryptoOnrampConfigured`, `purchaseStoreConfigured`, `privyAuthenticationConfigured`, `purchaseApprovalConfigured`, `purchasingConfigured`, `purchasingWebhookConfigured`, and `mppConfigured` all true. | VERIFIED LIVE CONFIGURATION |
| Stripe project/account | Stripe Projects project `project_61VHHVj5tBccbIy9D16UcjNbUWSQa7IlJM6tWxM5IEca`, merchant `SET Business Consults`, account `acct_1TTLQF2NmiYTbEIN`, production environment. | VERIFIED |
| Privy provider/resources | Privy provider link is complete for `st.et.enterprises@gmail.com`. Free plan resource `privy-plan` and free application resource `privy-app` are complete and members of production. The application is named `SET Business Consults`. | VERIFIED/PROVISIONED |
| Privy runtime authority | Source prefers Stripe Projects' managed `PRIVY_PRIVY_APP_ID`/`PRIVY_PRIVY_APP_SECRET` pair and otherwise supports conventional names. The obsolete single hard-coded app decree was removed. JWT verification uses Privy's official server SDK key-fetch/cache path unless an explicit local verification key is supplied, and still validates the exact runtime app audience, issuer, signature, and expiry. | VERIFIED IN SOURCE/TEST; LIVE AUTHENTICATED TOKEN NOT EXERCISED |
| Purchase approval key | Exact approval packets use a domain-separated HMAC key derived from the existing MPP secret unless an explicit project variable is injected. A backend Projects variable also exists for later hosting binding. | VERIFIED LIVE CONFIGURATION |
| Intake and error controls | Empty live intake returns 400 `invalid_request`; missing idempotency returns 400; missing exact approval confirmation returns 400; unsigned webhook returns 400. These checks did not persist a purchase or call a provider. | VERIFIED LIVE |
| Intake normalization/eligibility | Source normalizes asset/network/amount/budget/geography and fails closed on unsupported public geography before persistence. Stripe remains authoritative for provider eligibility. | SOURCE/TEST VERIFIED; LIVE CUSTOMER ELIGIBILITY UNKNOWN |
| Wallet ownership | Source binds records to a verified Privy subject, lists only that user's compatible wallets, requires customer confirmation to reuse/create, and records public wallet identity. | SOURCE/TEST VERIFIED; LIVE WALLET OPERATION NOT RUN |
| Quote and approval | Source fetches a current quote, records fees/amounts/timestamps, issues a digest/nonce approval packet, and requires exact approval before session creation. | SOURCE/TEST VERIFIED; LIVE QUOTE NOT RUN |
| Idempotent Onramp session | Source uses a deterministic business idempotency key, persists session identity, resumes known sessions, and queues ambiguous responses for reconciliation. | SOURCE/TEST VERIFIED; LIVE SESSION NOT CREATED |
| Stripe webhook subscription | Live enabled endpoint `we_1U8D8Q2NmiYTbEINKmbY8Qa9` targets `https://set-business-consults-mpp.onrender.com/webhooks/stripe` and subscribes to `crypto.onramp_session.updated` plus the existing PaymentIntent events. | VERIFIED LIVE |
| Webhook processing | Source verifies Stripe raw-body signatures, atomically deduplicates event IDs, suppresses stale/out-of-order state, reconciles provider state, and requires delivery amount plus transaction ID before entitlement release. | SOURCE/TEST VERIFIED; NO LIVE SIGNED ONRAMP EVENT |
| Persistence/recovery | Render PostgreSQL resource is complete. The deployed server starts with the migration path and public purchasing readiness is true. Source implements leases, retry/reschedule, quote expiry, reconciliation, and alert logs. | RUNTIME STARTUP VERIFIED; LIVE RECOVERY INCIDENT NOT EXERCISED |
| Existing payment capacity | Existing Checkout and MPP surfaces remain live. The MPP price is $0.50 USD per API call. No SET-Ledger source or deployment was modified by this release. | VERIFIED/UNCHANGED |
| Local verification | Secret scan, typecheck, all 14 test files/98 tests, and production build pass after the final source changes. | VERIFIED |
| Customer payment/KYC | No real customer payment, KYC completion, required action, Onramp session, wallet creation, or blockchain transaction was submitted. | VERIFIED NONE |
| Execution-wallet architecture | `docs/autonomous-purchasing-power-architecture.md` and `src/execution-policy.ts` define a separate SET-owned execution-wallet/policy/signing/accounting design. No funded wallet, production signer, autonomous transaction, or accounting close exists. | ARCHITECTURE ONLY |

## Permitted operational claim

The evidence supports: **SET currently has a live, operator-free purchasing orchestration prototype with configured Stripe, Privy, PostgreSQL, MPP, approval, webhook, persistence, deduplication, reconciliation, recovery, and entitlement controls.**

The evidence does not yet support: **a proven end-to-end autonomous purchasing-power system that has completed a real customer payment/KYC/Onramp/delivery cycle**, or **an operational SET-controlled autonomous execution wallet**.

## Remaining release evidence

1. Complete one authenticated non-payment customer flow through intake, Privy token verification, wallet selection/creation confirmation, and current quote.
2. Create a Stripe Onramp session only after the customer approves the exact quote; customer completes Stripe payment/KYC in Stripe's provider interface.
3. Capture the signed live `crypto.onramp_session.updated` delivery, replay it to prove deduplication, and record delivered amount plus transaction ID before entitlement release.
4. Exercise one recovery case and verify alert/reschedule/resolution evidence.
5. Release the separately governed SET execution wallet only after counsel-approved authority, capital ownership, signer, limits, recipients/contracts, provider policies, accounting, and incident controls are configured and tested.

No real payment, customer KYC, wallet creation, blockchain transaction, or SET-owned wallet signature was performed while producing this matrix.
