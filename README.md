# SET USA Ops Stripe Development

This Node.js and TypeScript service defaults to a local Stripe test environment. It pins Stripe API version `2026-07-29.dahlia`, verifies webhook signatures, and requires an explicit production-only configuration before accepting live keys.

## Start locally

```powershell
npm install
if (-not (Test-Path .env.app)) { Copy-Item .env.example .env.app }
npm run verify
npm run dev
```

Open `http://localhost:4242/health`. The server can run without Stripe credentials.

## Server-confirmed Payment Element page

The service exposes three Payment Intents + Payment Element offers:

- `GET /checkout` — $495 USD Workflow Improvement Review.
- `GET /checkout/workflow-improvement-review-297-usd` — $297 USD version.
- `GET /checkout/workflow-improvement-review-297-eur` — €297 EUR version.

Stripe.js renders Elements before an Intent exists, creates a short-lived ConfirmationToken, and sends its ID plus the buyer-supplied receipt/follow-up email to the offer-specific server endpoint. The server owns the offer ID, amount, currency, and matching explicit payment-method allowlist, then creates and confirms the PaymentIntent in an idempotent request. Dynamic payment-method selection is disabled.

The USD offers allow `card`, `cashapp`, `crypto`, `us_bank_account`, and `customer_balance`. Because bank-transfer customer balances require a Customer, the server creates an idempotent Customer and configures US bank-transfer funding for those offers. The EUR offer allows `card`, `bizum`, `eps`, `mb_way`, and `multibanco`. Cash App Pay is USD-only, and stablecoin payment presentment is USD unless Stripe separately grants private-preview currency support, so neither is included in the EUR allowlist. All three are direct SET billing: they do not use Connect, application fees, transfer fields, Custom Payment Methods, or automatic tax.

Configure a test restricted key and the matching test publishable key in the ignored `.env.app` file:

```dotenv
STRIPE_API_KEY=<least-privilege rk_test_... key>
STRIPE_PUBLISHABLE_KEY=<pk_test_... key>
STRIPE_WEBHOOK_SECRET=<whsec_... from stripe listen>
```

Then run `npm run dev` and open one of the checkout URLs above. Stripe returns to `/checkout/return` after any required customer action. ACH debit and customer-balance bank transfers can remain asynchronous. The webhook verifies and classifies PaymentIntent lifecycle events, but durable automated fulfillment is not implemented; confirm `payment_intent.succeeded` in Stripe before beginning manual delivery.

## $0.50 machine-payment API

## Crypto - Fiat embedded onramp

`GET /crypto-fiat` hosts Stripe's public-preview Embedded Onramp for US customers outside Hawaii. The customer selects an asset/network pair, supplies and confirms a public wallet address, and explicitly authorizes creation of one Onramp session. Stripe collects identity and payment information in its hosted embedded interface; the SET backend receives neither payment credentials nor wallet recovery material.

The Node service creates sessions with `StripeClient.rawRequest("POST", "/v1/crypto/onramp_sessions", ...)` because the public-preview endpoint does not yet have a stable typed binding in stripe-node. Live session creation fails closed unless the live API key, publishable key, signed webhook secret, and PostgreSQL event store are configured. `crypto.onramp_session.updated` shares the signature-verified webhook endpoint and uses durable event-ID claims before processing.

Embedded Components remains a separate private-preview integration and requires Stripe-provisioned Link OAuth credentials. Those credentials are not required by this Embedded Onramp fallback.

`POST /paid` uses Stripe MPP to charge **$0.50 USD for every successful API call**. An unpaid request receives an HTTP 402 challenge; a caller with a valid Shared Payment Token retries the request and receives both the JSON result and an MPP payment receipt.

The discovery document is available at `GET /openapi.json`. Configure a Stripe profile that matches the selected Stripe mode before starting the paid endpoint:

```dotenv
STRIPE_API_KEY=<least-privilege restricted key for the selected mode>
STRIPE_PROFILE_ID=<profile_test_... for sandbox or profile_... for live mode>
MPP_SECRET_KEY=<optional independent random secret of at least 32 bytes>
```

If `MPP_SECRET_KEY` is omitted, the server derives a challenge-binding key from the matching Stripe key, following Stripe's Node guide. Live MPP also requires the production configuration described below; a successful live validator round trip moves real funds.

Run the MPP validator while the server is listening:

```powershell
npx mppx@latest validate http://localhost:4242
```

## MCP tools for GPT and other agent clients

The service exposes a stateless Streamable HTTP MCP endpoint at `POST /mcp`. It is intentionally tool-only so the same contract works across ChatGPT, Codex, and other MCP-compatible hosts while the Stripe App supplies the Dashboard UI.

Current tools are read-only:

- `get_commerce_readiness` — returns non-secret MPP and Privy configuration gates.
- `prepare_crypto_acquisition` — normalizes a complete intake packet and returns the next confirmation gate.

Both tools declare read-only, non-destructive, idempotent annotations and return `executionAuthorized: false`. They cannot create a wallet, Onramp session, payment, approval, signature, swap, provider account, plan, or app resource.

After starting the server locally, run an MCP client or Inspector against:

```text
http://127.0.0.1:4242/mcp
```

The production plugin endpoint is:

```text
https://set-business-consults-mpp.onrender.com/mcp
```

Do not enable the installed plugin's remote MCP entry until the deployment containing `/mcp` is live and a fresh remote tool-list check succeeds.

## Stripe Dashboard app

The generated public Stripe App is in `set-agentic-commerce-app`. It provides a global Dashboard drawer at `stripe.dashboard.drawer.default`, uses signed requests to `/stripe-app/readiness`, and prepares `/stripe-app/events` for app-installation and PaymentIntent lifecycle events from installing merchants.

Local verification:

```powershell
Set-Location .\set-agentic-commerce-app
pnpm build
pnpm test
pnpm lint
npx stripe apps start --non-interactive
```

If `pnpm` is not installed globally, run the same commands through an ephemeral pinned CLI, for example `npx -y pnpm@10.17.1 build`. This does not require a global pnpm installation.

Connected-account app events are claimed in PostgreSQL through `AGENTIC_EVENTS_DB_URL`. The event ID is the table primary key and the handler uses one atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING` operation, so multiple service instances cannot react to the same verified Stripe event. A database failure returns HTTP 503 so Stripe can retry delivery.

Stripe generates the signing secret required by `fetchStripeSignature` only during the first `stripe apps upload`; keep that value and the connected-account webhook signing secret only in encrypted production configuration.

## Add test credentials

Prefer a least-privilege test restricted key. Put credentials only in the ignored `.env.app` file:

```dotenv
STRIPE_API_KEY=<test restricted key>
STRIPE_WEBHOOK_SECRET=<local webhook signing secret>
STRIPE_PROFILE_ID=<profile_test_...>
APPLICATION_BASE_URL=http://localhost:4242
```

Never commit `.env.app`, log credentials, or put a secret/restricted key in browser code. Keeping application credentials out of `.env` also prevents them from shadowing Stripe Projects CLI authentication.

## Production mode

Production requires `NODE_ENV=production`, `STRIPE_MODE=live`, an HTTPS `APPLICATION_BASE_URL`, matching live API and publishable keys, and a live webhook signing secret. Add the matching live `STRIPE_PROFILE_ID` to enable MPP. Connected-account, balance-payment, and subscription-development routes remain sandbox-only and return `404` in live mode. Store production secrets in the hosting provider's encrypted environment configuration, not in this repository.

## Stripe CLI

The CLI is installed locally as a development dependency. Authenticate or create/claim a Stripe sandbox only when that provider-side action has been approved.

```powershell
npm run stripe:whoami
npm run stripe:webhooks
```

The webhook listener prints a local signing secret. Place it in `.env.app`, restart the server, and send test events through the CLI. Every incoming event is signature-verified before acknowledgement.

## Read-only authenticated smoke test

After adding a test key, run:

```powershell
npm run stripe:smoke
```

This retrieves the current Stripe account object and creates no Stripe resources. It is intentionally separate from `npm run verify`.

## Repository guard

The repository uses a local pre-commit hook that runs the Stripe secret scanner. Re-enable it after a fresh clone with:

```powershell
git config core.hooksPath .githooks
```

## Development status

- `[V]` Local configuration and tests pin API version `2026-07-29.dahlia`.
- `[V]` Live credentials are accepted only when production mode, HTTPS, and the required Checkout and webhook configuration are all present; `.env.app` and other `.env.*` files are ignored.
- `[V]` Webhook requests fail closed unless the signature can be verified.
- `[V]` The live SET account, production deployment, and dedicated PaymentIntent webhook endpoint were inspected on 2026-08-24.
- `[D]` No live payment was submitted during implementation or verification. Fulfillment remains a manual, webhook-verified operating step until a durable reconciliation store is added.

## Blueprint routes

With a test restricted key configured, the local server exposes the blueprint operations:

- `POST /stripe/accounts` — create an Accounts v2 connected account.
- `POST /stripe/accounts/:accountId/onboarding-link` — create hosted KYC onboarding.
- `POST /stripe/accounts/:accountId/checkout-session` — create a connected-account Checkout Session.
- `POST /stripe/subscription-plan` — create the platform subscription Product and Price.
- `POST /stripe/accounts/:accountId/setup-intent` — attach a `stripe_balance` payment method.
- `POST /stripe/accounts/:accountId/subscription` — create the connected-account subscription.

Returned identifiers are stored locally in `.data/stripe-resources.json` (ignored by Git). Provider calls remain opt-in and test-mode-only; the implementation does not create resources during `npm run verify`.

See [STRIPE_UPGRADE_PLAN.md](./STRIPE_UPGRADE_PLAN.md) before migrating an existing integration or changing an account default.
