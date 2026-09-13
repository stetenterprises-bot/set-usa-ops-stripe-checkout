# Set-Ledger release evidence — September 13, 2026

Public site: https://ledgerline-compliance.sthomas935.chatgpt.site

## Published implementation

- Sites version 62, source `b42612695905a322e8a77f2a6394b8a910a6d300`; deployment `appgdep_6aa73515bfa48191b16db0541210009f` succeeded, environment revision 11, public audience.
- Backend application source `2ed3cd74bf1db534779a8ed7d958210fcfb6dc3b` pushed to Render's deployment branch. The live wallet bundle contains the new recovery action; the live MCP tool returns the new retainer contract.
- Contract: $195 USD/month for maintenance of a working on-ramp link. Verified payment unlocks the hosted launch kit; signed paid checkout events create or attach a client workspace. Custom domains and bespoke integrations remain operator follow-up.
- Wallet flow: customer Privy authentication, owned wallet confirmation, current quote and budget consent, embedded Stripe session, durable resume, provider-confirmed amount/address/network/transaction evidence. Recovery export uses a browser-generated HPKE recipient; only encrypted export material passes through SET.

## Verification performed

- Backend secret scan, TypeScript checks, production build and automated tests passed. The final suite contains 138 tests in 19 files.
- Site release verification passed: TypeScript, lint, production build, 24 tests, publication boundary scan.
- Eleven simulated browser checks passed, including exact quote consent, nested Stripe status events, no browser-only fulfillment claim, retry/resume, dashboard retry, next purchase, and browser decryption/download of a synthetic recovery key. No real private key was exported.
- Live wallet displayed Privy's sign-in dialog with no page errors or failed resources. One earlier rollout-time probe returned 503; the repeated probe passed.
- Live read-only MCP caller `scripts/discover-onramp-product.mjs` returned 19500 USD minor units/month, the approved service scope, public checkout and wallet URLs, and `executionAuthorized: false`.
- A known unpaid live Checkout Session returned HTTP 200 with `paid: false` through the Site. The deployed delivery page hid its kit for a simulated unpaid result and downloaded the correct kit after a simulated paid result. This is not evidence of a real paid subscription.
- Both live Stripe webhook endpoints were enabled and included checkout, asynchronous checkout success, invoice payment/failure, subscription lifecycle, and `crypto.onramp_session.updated` events. A signed nonpayment `account.updated` event was replayed separately to each listener; pending webhooks returned to zero after each delivery. This establishes transport, not paid fulfillment.
- Public homepage, retainer, connect, robots.txt, sitemap.xml and llms.txt returned HTTP 200 without authentication. Robots allows public marketing pages and excludes private operational routes. Search engine indexing/ranking is not established.
- MPP discovery is `/openapi.json`, which returned HTTP 200 with the separate `/paid` assessment route. `/.well-known/mpp` is not a configured route and returned 404. No machine payment was made.

## Operator and customer destinations

- Purchase: https://ledgerline-compliance.sthomas935.chatgpt.site/retainer
- Wallet: https://ledgerline-compliance.sthomas935.chatgpt.site/wallet
- Operator purchase/follow-up queue: https://ledgerline-compliance.sthomas935.chatgpt.site/engagements
- Signed webhook receiver: https://ledgerline-compliance.sthomas935.chatgpt.site/api/internal/webhooks
- MCP: https://set-business-consults-mpp.onrender.com/mcp

The webhook records purchases and required follow-up in the operator queue; this release does not establish an additional email, SMS or mobile push notification channel.

## Remaining real-customer evidence

UNKNOWN: completed real $195 subscription and actual customer workspace activation; authenticated real Privy wallet selection/export; a provider-accepted customer quote/payment followed by final on-chain delivery. These require the customer's authentication, amount/asset selection, payment details and any provider verification. Configuration, mocks and successful health checks do not substitute for those results.

No guaranteed revenue, proprietary ownership of Privy/Stripe, custom domain registration, or uninterrupted hosting availability is asserted. The verified public domain is the Sites address above. The backend currently uses Render's Free service; an observed successful request does not establish an uptime guarantee.
