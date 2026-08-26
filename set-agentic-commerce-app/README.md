# SET Agentic Commerce Stripe App

This public Stripe App is prepared for a global Dashboard drawer, signed calls to the SET hosted backend, and connected-account event delivery. It is local-only until an authorized app version is uploaded and installed in a Stripe sandbox.

## Local verification

```powershell
pnpm install
pnpm build
pnpm test
pnpm lint
npx stripe apps start --non-interactive
```

The local backend adapter can be started separately:

```powershell
$env:PORT = "4243"
pnpm start:backend
```

Keep these values in encrypted deployment configuration, never in the repository:

- `STRIPE_APP_SIGNING_SECRET` verifies `fetchStripeSignature` calls from the Dashboard drawer.
- `STRIPE_APP_WEBHOOK_SECRET` verifies Stripe App and connected-account events.
- The existing SET runtime variables provide MPP, Checkout, webhook, and Privy readiness.

The first `stripe apps upload` creates the app signing secret needed to exercise `fetchStripeSignature`, but upload is intentionally outside this local preparation. After separate upload authorization, upload a version to a Stripe sandbox, configure `/stripe-app/events` as the connected-account event endpoint, install it in the sandbox, and then run the signed drawer and webhook smoke tests.

The drawer is read-only. It never authorizes a payment, creates a wallet or Onramp session, signs a transaction, performs a swap, or changes a provider resource.
