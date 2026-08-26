# SET Agentic Commerce live-publication matrix

Checked: 2026-08-26 America/Chicago

This matrix is the release gate for the next publication. `UNKNOWN` and `BLOCKED` entries must not be described as operationally complete.

| Gate | Current evidence | State |
|---|---|---|
| Source commit | Release content is committed at `708586e` on `release/live-checkout`; the matrix-only commit and remote push follow this evidence snapshot. | VERIFIED locally; push pending |
| Public host | `https://set-business-consults-mpp.onrender.com`; `/`, `/health`, and `/openapi.json` returned HTTP 200. | VERIFIED for current deployment |
| Public paid route | Unpaid `POST /paid` returned HTTP 402 with a Stripe MPP challenge for $0.50 USD. | VERIFIED without payment |
| Stripe account and mode | `SET Business Consults`, live account `acct_1TTLQF2NmiYTbEIN`; charges and payouts enabled. | VERIFIED |
| MPP profile | Current live challenge contains a live Stripe profile and card/Link methods. | VERIFIED, identifier omitted here |
| MPP full round trip | Stripe documents that live `mppx validate` can move real funds. No live validator payment was submitted. | NOT RUN; separately payment-authorized |
| Stablecoin MPP | Current challenge advertises card and Link only; no Tempo or Solana stablecoin method is present. | NOT ENABLED |
| Offer amounts/currencies | $495 USD, $297 USD, and EUR 297 checkout offers; $0.50 USD MPP request. | VERIFIED in source |
| Live account payment-method availability | Authenticated account capabilities show active card, Link, Cash App Pay, crypto, ACH, US bank transfer, Bizum, EPS, MB WAY, Multibanco, and other methods. | VERIFIED at account layer |
| Transaction-specific eligibility | Exact eligibility for every offer, customer location, return flow, and funding path was not re-run during this publication pass. | UNKNOWN |
| User-selected static allowlists | USD: `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`; EUR: `card`, `bizum`, `eps`, `mb_way`, `multibanco`. | VERIFIED in source; no change made |
| Client/server allowlist parity | Client configuration is derived from the same offer object used for `allowed_payment_method_types`; unit tests pass. | VERIFIED |
| Redirect/asynchronous/customer behavior | Return route exists; ACH/customer balance can be asynchronous; customer balance creates a Customer and US bank-transfer funding instructions. | VERIFIED in source |
| Partial funding | Customer-balance bank transfer can require asynchronous or partial funding behavior; no new live transaction check was performed. | UNKNOWN live outcome |
| Webhook endpoint | Enabled live endpoint at `/webhooks/stripe` subscribes to the six PaymentIntent lifecycle events handled by source. | VERIFIED |
| Webhook signature verification | Raw-body verification fails closed; tests pass. | VERIFIED |
| Durable Stripe App event deduplication | A Render PostgreSQL 18 instance in Ohio is provisioned. The handler atomically claims each event ID with a primary key plus `INSERT ... ON CONFLICT DO NOTHING RETURNING`, returns 503 on storage failure, and passes single-instance, cross-instance, and SQL contract tests. `AGENTIC_EVENTS_DB_URL` is saved as an encrypted Render variable. | LOCALLY VERIFIED; deployment pending |
| Durable-store retention/HA | The provisioned free Render database expires on September 25, 2026 unless upgraded; it has no HA and the free web service can spin down. | BLOCKED for durable production beyond smoke testing; paid compute selection required |
| Idempotent fulfillment state | Checkout fulfillment remains manual; the MPP paid response is immediate after protocol verification. No durable fulfillment state store exists. | NOT IMPLEMENTED for Checkout |
| Authenticated smoke | Live Stripe account and webhook endpoints were read through Stripe MCP; root verification passes secret scan, typecheck, 34 tests, and production build; local `/mcp` initialization, tool listing, and readiness call passed. | VERIFIED locally |
| Real payment submitted | None during this pass. | VERIFIED NONE |
| Agentic Commerce Suite | Stripe ACS agent mode is private preview and separate from MPP. Dashboard onboarding, agent verification, SFTP feed intake, OCA state, and v2 event destination are not verified. | UNKNOWN / PREVIEW GATE |
| Privy provider link | Stripe Projects status shows Privy provider link `complete`. | VERIFIED |
| Privy plan | No Privy plan appears in Stripe Projects. Core is $299/month and is the catalog tier that explicitly includes fiat onramp. | BLOCKED on explicit plan selection |
| Exact Privy app | Required app locator `cmt7hoxq900i20cl79s3r6sva` is not attached as a Stripe Projects service. | BLOCKED |
| Privy existing-resource preflight | Despite the completed provider link, `--existing --preflight` reports Privy as unlinked and requests browser auth. | BLOCKED by Projects state inconsistency |
| Privy runtime credentials | Local development reports configured values without revealing them; the live `/health` endpoint reports `privyConfigured: false`. | BLOCKED in production |
| Codex plugin | Personal plugin source validates and now declares the production SET MCP endpoint. Reinstall/new-thread pickup is intentionally deferred until `/mcp` is deployed. | PREPARED, NOT ACTIVATED |
| Portable MCP plugin | Two read-only tools compile, pass protocol tests, and pass local Streamable HTTP smoke. Production `/mcp` is not deployed yet. | PREPARED, NOT LIVE |
| Stripe App tooling | Stripe Apps CLI and generator are installed. Root verification passes; the app independently passes TypeScript build, two UI tests, two backend tests, lint, and local Stripe compilation. | VERIFIED |
| Stripe Apps Agreement | The account owner explicitly authorized acceptance, and the Stripe Dashboard confirmed `Terms and Conditions accepted` for SET Business Consults. | VERIFIED |
| Stripe App | Official generator created app ID `set-agentic-commerce`. The generated full-page sample was replaced with a public `stripe.dashboard.drawer.default` app using platform access, signed SET-backend readiness, connected-account event permissions, and a 300x300 PNG app icon. App build, four app tests, lint, and local Stripe compilation pass. | LOCALLY VERIFIED, NOT UPLOADED |
| Stripe App backend | `/stripe-app/readiness` verifies the app signature and returns non-secret gates; `/stripe-app/events` verifies signatures and classifies install/deauthorization plus PaymentIntent lifecycle events. CORS is restricted to the UI-called route. | LOCALLY VERIFIED |
| Stripe App upload/install | First upload is required before `fetchStripeSignature` and Secret Store signing material exist. No upload or install was performed. | NOT RUN |
| Marketplace publication | The icon is prepared. Stripe Marketplace review and OpenAI/LLM client distribution still require successful hosted/install smoke tests plus listing screenshots, privacy/support/terms URLs, domain verification, and review submission. | NOT READY |

## Publication order

1. Create the release commit and push it to `release/live-checkout` so Render auto-deploys.
2. Verify the deployed commit, `/health`, `/openapi.json`, unpaid `/paid` challenge, `/mcp` initialize/list/call flow, and fail-closed Stripe App endpoints.
3. Upload the Stripe App, store the generated signing material only in encrypted Render configuration, and install the version in a sandbox.
4. Configure connected-account sandbox events and run a signed delivery/duplicate test before any live installation.
5. Resolve the Privy plan and existing-resource attachment gate without creating a replacement app or silently accepting a paid tier.
6. Upgrade the expiring free PostgreSQL service before representing durable multi-instance fulfillment as production-complete.
7. Run only non-payment smoke tests first. Run live `mppx validate` only under separate authorization because it can move real funds.
8. Activate the MCP plugin/client distribution only after the remote tool list passes; submit Marketplace listing artifacts only after the installed sandbox flow passes.
