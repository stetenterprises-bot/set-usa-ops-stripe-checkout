# SET USA Ops Stripe Development

This Node.js and TypeScript service defaults to a local Stripe test environment. It pins Stripe API version `2026-07-29.dahlia`, verifies webhook signatures, and requires an explicit production-only configuration before accepting live keys.

## Start locally

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run verify
npm run dev
```

Open `http://localhost:4242/health`. The server can run without Stripe credentials.

## Server-confirmed Payment Element page

`GET /checkout` serves a Payment Intents + Payment Element flow for the $495 Workflow Improvement Review. Stripe.js renders Elements before an Intent exists, creates a short-lived ConfirmationToken, and sends only that token ID to `POST /checkout/confirm-intent`. The server fixes the amount and currency, then creates and confirms the PaymentIntent in one idempotent request. It is direct SET billing: it does not use Connect, application fees, transfer fields, hard-coded payment methods, or automatic tax.

Configure a test restricted key and the matching test publishable key in the ignored `.env` file:

```dotenv
STRIPE_API_KEY=<least-privilege rk_test_... key>
STRIPE_PUBLISHABLE_KEY=<pk_test_... key>
STRIPE_WEBHOOK_SECRET=<whsec_... from stripe listen>
```

Then run `npm run dev` and open `http://localhost:4242/checkout`. Stripe returns to `/checkout/return` after any required customer action, but fulfillment must rely on the signature-verified `payment_intent.succeeded` event at `/webhooks/stripe` rather than the browser return page.

## $0.50 machine-payment API

`POST /paid` uses Stripe MPP to charge **$0.50 USD for every successful API call**. An unpaid request receives an HTTP 402 challenge; a caller with a valid Shared Payment Token retries the request and receives both the JSON result and an MPP payment receipt.

The discovery document is available at `GET /openapi.json`. Configure a Stripe sandbox profile before starting the paid endpoint:

```dotenv
STRIPE_API_KEY=<least-privilege sandbox restricted key>
STRIPE_PROFILE_ID=<profile_test_... from the Stripe Dashboard>
MPP_SECRET_KEY=<optional independent random secret of at least 32 bytes>
```

If `MPP_SECRET_KEY` is omitted, the server derives a challenge-binding key from the Stripe sandbox key, following Stripe's Node guide. Live Stripe keys and live profile IDs remain blocked in this local project.

Run the MPP validator while the server is listening:

```powershell
npx mppx@latest validate http://localhost:4242
```

## Add test credentials

Prefer a least-privilege test restricted key. Put credentials only in the ignored `.env` file:

```dotenv
STRIPE_API_KEY=<test restricted key>
STRIPE_WEBHOOK_SECRET=<local webhook signing secret>
STRIPE_PROFILE_ID=<profile_test_...>
APPLICATION_BASE_URL=http://localhost:4242
```

Never commit `.env`, log credentials, or put a secret/restricted key in browser code.

## Production mode

Production requires `NODE_ENV=production`, `STRIPE_MODE=live`, an HTTPS `APPLICATION_BASE_URL`, matching live API and publishable keys, and a live webhook signing secret. Sandbox-only MPP, connected-account, balance-payment, and subscription-development routes return `404` in live mode. Store production secrets in the hosting provider's encrypted environment configuration, not in this repository.

## Stripe CLI

The CLI is installed locally as a development dependency. Authenticate or create/claim a Stripe sandbox only when that provider-side action has been approved.

```powershell
npm run stripe:whoami
npm run stripe:webhooks
```

The webhook listener prints a local signing secret. Place it in `.env`, restart the server, and send test events through the CLI. Every incoming event is signature-verified before acknowledgement.

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
- `[V]` Live API-key prefixes are blocked and `.env` files are ignored.
- `[V]` Webhook requests fail closed unless the signature can be verified.
- `[I]` Account authentication, account-default API version, and provider webhooks have not been inspected.
- `[D]` No live payment, catalog, customer, account, or webhook object is created by this scaffold.

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
