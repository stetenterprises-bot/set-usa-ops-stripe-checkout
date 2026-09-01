# SET Agentic Commerce & Wallet Activation Review

## The offer

**Price:** $495 USD, paid to SET Business Consults before the review begins.

**Promise:** SET maps and validates a customer-controlled agentic commerce workflow that can accept machine or human payments, authenticate a user through Privy, prepare a compatible user-owned wallet, and hand the user into Stripe Onramp for provider-controlled KYC, fiat collection, crypto purchase, and delivery.

**Ideal buyer:** A US business, software founder, AI-agent developer, Web3 product team, or professional-services firm that wants a deployable payment-to-wallet workflow without taking custody of customer fiat, crypto, private keys, or KYC records.

**Deliverables:**

1. A 45-minute intake and architecture session.
2. A written current-state readiness matrix.
3. One normalized asset, network, fiat-budget, and destination-wallet workflow.
4. Stripe payment and webhook architecture for the buyer's commercial service.
5. Privy authentication and user-owned wallet ownership map.
6. Stripe Onramp session and delivery-verification map.
7. MCP/MPP agent discovery and paid-call specification.
8. A prioritized activation plan with tested endpoints, unresolved gates, owners, and next actions.

**Boundaries:** The $495 charge purchases SET's review and implementation plan. It is not the fiat principal for a crypto purchase. Stripe separately presents Onramp KYC and payment collection and delivers supported crypto directly to the user's confirmed wallet. Wallet creation and every Onramp session require a separate customer authorization. Swaps, bridges, approvals, signatures, and dApp actions are excluded unless separately scoped and authorized.

## Buyer-facing positioning

### Headline

Turn an AI request into a verified payment-to-wallet workflow.

### Subheadline

SET Business Consults designs the agent, Stripe, and Privy handoffs required to collect service revenue, authenticate the customer, prepare a user-owned wallet, and deliver crypto through Stripe Onramp without putting SET in custody of customer funds or keys.

### Primary call to action

Book the **Agentic Commerce & Wallet Activation Review — $495**.

### Short pitch

Your agent should do more than answer questions. SET maps the workflow that lets it discover an offer, collect payment, verify the receipt, authenticate the customer, prepare a user-owned Privy wallet, and hand the customer into Stripe's Onramp experience. You receive a concrete activation matrix, API map, and implementation sequence rather than a generic strategy document.

## Current SET production surface

Base URL: `https://set-business-consults-mpp.onrender.com`

### Verified reachable, read-only endpoints

| Method | Endpoint | Current verified result | Commercial role |
|---|---|---|---|
| `GET` | `/health` | `200`; reports live Stripe, Checkout, webhook, Onramp, Embedded Components, MPP, and Privy configuration flags | Internal readiness evidence; do not expose secrets |
| `GET` | `/` | `200`; identifies the SET paid API and $0.50 unit price | Agent/human service discovery |
| `GET` | `/openapi.json` | `200`; advertises `POST /paid` and its MPP payment requirement | Machine-readable paid API discovery |
| `GET` | `/checkout` | Checkout page is implemented | Human payment surface |
| `GET` | `/checkout/config` | `200`; returns the current $495 Workflow Improvement Review offer | Current human collection offer |
| `GET` | `/checkout/:offerId/config` | Implemented for registered offer IDs | Offer-specific checkout configuration |
| `GET` | `/checkout/payment-intent/:paymentIntentId` | Implemented; validates `pi_` identifier and returns status | Browser payment reconciliation |
| `GET` | `/checkout/return` | Implemented | Browser return surface |
| `GET` | `/crypto-fiat` | Implemented | Stripe crypto Embedded Components UI |
| `GET` | `/crypto-fiat/components/config` | `200`; reports live US configuration and US-excluding-New-York availability | Components readiness only |
| `GET` | `/private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY/config` | `200`; returns configured asset/network pairs | Private Onramp readiness |

### Implemented state-changing endpoints

These routes exist, but their presence alone is not authorization to invoke them.

| Method | Endpoint | API/provider call | Required gate |
|---|---|---|---|
| `POST` | `/paid` | MPPX payment middleware plus a deterministic readiness assessment | Valid bounded input, idempotency key, and a credential scoped to that key and request hash |
| `POST` | `/paid/recover` | Returns an already-paid, durably persisted readiness artifact | Identical bounded input and idempotency key; never initiates payment |
| `POST` | `/checkout/confirm-intent` | `stripe.paymentIntents.create` using a Stripe ConfirmationToken | Customer submits Checkout and explicitly confirms payment |
| `POST` | `/checkout/:offerId/confirm-intent` | Same, for a named registered offer | Same |
| `POST` | `/crypto-fiat/components/link-auth-intent` | `POST https://login.link.com/v1/link_auth_intent` | Customer supplies email and begins Link authentication |
| `POST` | `/crypto-fiat/components/session` | `POST /v1/crypto/onramp_sessions` with Link OAuth token | Valid Link auth, customer, payment token, amount, and Base wallet |
| `POST` | `/crypto-fiat/components/session/:sessionId/quote` | Refreshes `/v1/crypto/onramp_sessions/:id/quote` | Existing valid session and Link authorization |
| `POST` | `/crypto-fiat/components/session/:sessionId/checkout` | Begins `/v1/crypto/onramp_sessions/:id/checkout` | Customer mandate acceptance and valid session |
| `POST` | `/private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY/session` | `stripe.rawRequest('POST', '/v1/crypto/onramp_sessions', ...)` | Explicit `confirmed: true`, valid supported pair, and confirmed wallet address |
| `POST` | `/webhooks/stripe` | Verifies Stripe signature and claims event ID in durable storage | Stripe-signed delivery only |
| `POST` | `/stripe-app/events` | Verifies Stripe App event signature and deduplicates event IDs | Stripe App-signed delivery only |
| `POST` | `/stripe-app/readiness` | Verifies Stripe App UI signature | Signed drawer request; currently unresolved in sandbox |
| `POST` | `/mcp` | MCP Streamable HTTP transport | Valid JSON-RPC/MCP request |

### Complete route disposition

The following additional routes are implemented but are not part of the current live customer offer:

| Method | Endpoint | Live disposition |
|---|---|---|
| `OPTIONS` | `/stripe-app/readiness` | CORS preflight for the Stripe global drawer |
| `GET` | `/crypto-fiat` | Public Embedded Components page; reachable, but transaction execution remains customer-gated |
| `GET` | `/private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY` | Private-path Embedded Onramp page; the path itself is not authentication and must not be treated as an access-control boundary |
| `GET` | `/mcp` | Intentionally returns `405`; MCP uses `POST` |
| `DELETE` | `/mcp` | Intentionally returns `405` |
| `POST` | `/stripe/accounts` | Sandbox-only Accounts v2 creation; unavailable in live mode |
| `POST` | `/stripe/accounts/:accountId/onboarding-link` | Sandbox-only Account Link creation; unavailable in live mode |
| `POST` | `/stripe/accounts/:accountId/checkout-session` | Sandbox-only connected-account Checkout creation; unavailable in live mode |
| `POST` | `/stripe/subscription-plan` | Sandbox-only test Product/Price creation; unavailable in live mode |
| `POST` | `/stripe/accounts/:accountId/setup-intent` | Sandbox-only `stripe_balance` SetupIntent; unavailable in live mode |
| `POST` | `/stripe/accounts/:accountId/subscription` | Sandbox-only test subscription; unavailable in live mode |

Static asset requests under `/assets/*` support the checkout and crypto pages. Unknown routes return the service's normal not-found response.

### MCP tools currently available

| Tool | Current behavior | Monetization role |
|---|---|---|
| `get_commerce_readiness` | Returns non-secret MPP and Privy readiness; always `executionAuthorized: false` | Free qualification tool |
| `prepare_crypto_acquisition` | Normalizes a complete intake packet; never creates wallet, payment, or Onramp resources | Free or paid preflight tool |

The next paid MCP tool should be `purchase_activation_review`. It should validate the buyer's intake, return the canonical $495 payment URL for humans and MPP endpoint for capable agents, and release the review workflow only after a verified Stripe receipt.

## API request contracts

### MPP-paid API call

```http
POST /paid HTTP/1.1
Host: set-business-consults-mpp.onrender.com
Content-Type: application/json

{
  "service": "agentic-commerce-wallet-activation-review",
  "organization": "Example Company",
  "contact": "buyer@example.com"
}
```

Without a payment credential, a valid request returns an MPP `402 Payment Required` challenge. An MPP-capable client obtains the supported credential, retries, and receives a versioned readiness artifact plus the MPP receipt. The `$0.50` price applies only to this machine-readable readiness assessment. It is not the `$495` human review and does not authorize wallet, Onramp, KYC, crypto-purchase, or execution-wallet activity. Deployment and a successful paid provider round trip remain unverified until a new release matrix records them.

### Human $495 checkout

```http
GET /checkout/workflow-improvement-review-495-usd
```

The browser creates a Stripe ConfirmationToken and submits:

```http
POST /checkout/workflow-improvement-review-495-usd/confirm-intent
Content-Type: application/json
Idempotency-Key: set-review-<opaque-id>

{
  "confirmationTokenId": "ct_...",
  "customerEmail": "buyer@example.com"
}
```

The backend creates and confirms a PaymentIntent for `49500 usd`, attaches SET offer metadata, and returns only the PaymentIntent identifier, client secret, and status required by the browser. Fulfillment waits for the signed webhook rather than the browser redirect.

### Privy customer and wallet handoff

The current repository verifies that runtime configuration is bound to the approved Privy application ID `cmt7hoxq900i20cl79s3r6sva`, but it does not yet expose a production route that authenticates a Privy user or creates/retrieves a Privy user-owned wallet. Add an authenticated SET route only after current Privy server-API semantics are confirmed:

```http
POST /privy/wallets/prepare
Authorization: Bearer <verified Privy user token>
Idempotency-Key: set-wallet-<opaque-id>

{
  "requestId": "set_req_...",
  "network": "ethereum",
  "reuseConfirmedWalletId": "optional-wallet-reference"
}
```

The backend must verify the Privy access token, bind the wallet owner to that Privy user, and return only the wallet reference, public address, network, and ownership state. It must never return recovery material or create an app-controlled wallet as a substitute.

### Embedded Onramp session

```http
POST /private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY/session
Content-Type: application/json

{
  "confirmed": true,
  "network": "ethereum",
  "currency": "usdc",
  "walletAddress": "0x..."
}
```

Currently configured pairs are:

- BTC on Bitcoin;
- ETH on Ethereum;
- USDC on Ethereum;
- SOL on Solana;
- USDC on Solana.

Availability, geography, limits, and the exact pair must be revalidated for each transaction. The returned client secret belongs only in the authenticated browser session and must not be logged, placed in a URL, or returned through an MCP completion packet.

## Provider and project attachments

### Stripe project

- Project: `Set Business Consults (USA Ops)`
- Merchant: `SET Business Consults`
- Merchant account: `acct_1TTLQF2NmiYTbEIN`
- Active Stripe Projects environment: `production`
- Stripe Projects authentication: verified
- Current source branch: `release/live-checkout`
- Current source commit at preparation: `fef8e6edbd83eb819b16f5352ee0086bb5ad1d18`

### Privy

- Provider link: complete
- Approved existing application: `cmt7hoxq900i20cl79s3r6sva`
- Runtime configuration reports both Privy variables present
- Default wallet-chain metadata exposed by readiness: Base, chain ID 8453
- Stripe Projects plan: none listed
- Stripe Projects `privy/app` service: none listed
- Production Privy user authentication and user-owned wallet API smoke: not yet evidenced

The provider link and Render runtime secret binding must not be represented as a Stripe Projects-managed Privy application attachment. They are separate attachment layers.

### Render

- Provider link: complete
- Web service: `mpp-hosting`
- Render service name: `set-business-consults-mpp`
- Source: the SET GitHub repository, `release/live-checkout`
- Auto-deploy: enabled
- Health route: `/health`
- Region: Ohio
- Durable Postgres service: `agentic-events-db`, PostgreSQL 18, Ohio
- Redacted project bindings: `MPP_HOSTING_URL`, `AGENTIC_EVENTS_DB_URL`

### Stripe App

- App: `SET Agentic Commerce`
- Immutable sandbox version: `0.0.5`
- Sandbox installation: completed
- Global Dashboard drawer: installed
- Permissions previously accepted: `event_read`, `payment_intent_read`
- Signed readiness: unresolved; sandbox drawer request currently receives `401 invalid_signature`

## Customer acquisition workflow

### Segment 1: AI and MCP developers

Target founders and engineering leads building MCP servers, agent wallets, paid tools, agent marketplaces, or AI-assisted checkout.

**Trigger:** They have a callable tool but no reliable machine-payment, receipt, or fulfillment layer.

**Message:**

> Your MCP tool can be discoverable and useful without being commercially complete. SET maps the HTTP 402 challenge, Stripe receipt, webhook fulfillment, and customer-owned wallet handoff needed to turn an agent call into paid work. The fixed-price activation review is $495.

### Segment 2: Crypto and Web3 product teams

Target wallets, dApps, membership products, NFT utilities, stablecoin applications, and crypto-enabled professional services.

**Trigger:** Their users must leave the product to acquire supported crypto or the team is unsure who owns the wallet and KYC boundary.

**Message:**

> SET designs a non-custodial acquisition path in which Privy authenticates the user and owns the wallet relationship while Stripe handles Onramp KYC, payment, purchase, and delivery. You receive the exact API, consent, webhook, and recovery map for $495.

### Segment 3: Stripe consultants and SaaS implementers

Target agencies and platform teams that want an agentic-commerce add-on without building the first architecture from scratch.

**Trigger:** They already implement Stripe but have no MPP, MCP, or embedded-wallet capability.

**Message:**

> Add an agentic-commerce and wallet-readiness module to your Stripe implementation. SET supplies a tested reference architecture, readiness matrix, and provider-boundary review; you keep the client implementation relationship.

## Marketing system

### Weekly content cadence

1. **Monday — problem post:** Explain one failure mode: agent can call a tool but cannot pay; payment succeeds but fulfillment is not idempotent; wallet exists but is app-controlled; Onramp completes but delivery evidence is missing.
2. **Tuesday — technical proof:** Publish one sanitized sequence diagram, endpoint contract, or webhook pattern.
3. **Wednesday — buyer story:** Describe the before/after operational workflow without claiming unsupported results.
4. **Thursday — direct offer:** Invite qualified teams to the $495 activation review.
5. **Friday — demonstration:** Show the live health/discovery surface, a sandbox MPP challenge, or an intake-only MCP call. Do not demonstrate a real crypto purchase as a marketing stunt.

### Lead magnet

Offer a free **Agentic Commerce Readiness Scorecard** covering:

- agent/tool discovery;
- payment challenge and receipt;
- human checkout fallback;
- webhook verification;
- durable fulfillment;
- user authentication;
- wallet ownership;
- Onramp approval and geography;
- asset/network validation;
- delivery evidence.

The scorecard ends with one of three dispositions: `not ready`, `sandbox activation`, or `production review`. The $495 offer is the conversion path for the latter two.

### Outreach operating rhythm

Each business day:

1. Identify 10 qualified companies from public product evidence.
2. Record the company, relevant product, observed trigger, likely owner, source URL, and one personalized hypothesis.
3. Send no more than one concise first-touch message per contact.
4. Follow up on business day 3 with one technical observation.
5. Follow up on business day 7 with the scorecard and a direct booking link.
6. Close the sequence after the second follow-up unless the prospect engages.

Suggested initial monthly funnel:

| Stage | Target |
|---|---:|
| Qualified accounts researched | 200 |
| Personalized first touches | 150 |
| Positive conversations | 20 |
| Qualification calls | 10 |
| Paid reviews | 4 |
| Initial review revenue | $1,980 |
| Follow-on implementations | 1-2 |

These are operating targets, not forecast guarantees. Track actual conversion by segment and source before scaling volume.

## Sales process

### 1. Qualification

Confirm:

- what the buyer sells;
- whether the buyer needs agent payment, human payment, crypto acquisition, or all three;
- target users and geography;
- whether the buyer already has Stripe and Privy accounts;
- target asset/network pairs;
- whether wallets must be user-owned;
- current environment and expected transaction volume;
- desired launch date and responsible technical owner.

Disqualify or rescope requests that require SET to custody customer keys, receive crypto-purchase principal, autonomously trade, or bypass provider KYC.

### 2. Proposal

Send a one-page scope with:

- fixed $495 price;
- listed deliverables;
- buyer-provided access/evidence;
- exclusions;
- delivery date, normally three business days after complete intake;
- separate pricing for implementation work.

### 3. Collection

Human buyer:

1. Direct the buyer to the named $495 Checkout route.
2. Buyer enters email and confirms the payment in Stripe UI.
3. Backend confirms the PaymentIntent using a ConfirmationToken and idempotency key.
4. Signed `payment_intent.*` webhook arrives at `/webhooks/stripe`.
5. Postgres claims the Stripe event ID.
6. SET opens the paid engagement only after the verified payment state satisfies the chosen fulfillment rule.
7. Stripe settles the service revenue into the SET Stripe account, net of applicable Stripe fees.

MPP-capable agent:

1. Agent discovers `/openapi.json` or an MCP tool returns a payment URL.
2. Agent calls the paid endpoint.
3. SET returns an HTTP 402 MPP challenge.
4. Agent obtains an accepted credential and retries.
5. SET verifies/captures the payment through its Stripe profile.
6. SET returns a receipt and creates the engagement record.

Until a $495 MPP SKU is implemented and tested, use MPP for the existing $0.50 paid API/intake and use Stripe Checkout for the $495 review.

### 4. Onboarding

After verified payment:

1. Generate a SET engagement ID and send the secure intake link.
2. Collect business and technical context, not card data, private keys, seed phrases, or KYC documents.
3. Obtain access through least-privilege invitations or screenshots/read-only evidence where possible.
4. Run the readiness matrix.
5. Conduct the architecture session.
6. Deliver the written activation packet.
7. Offer a separately priced implementation statement of work.

### 5. Delivery and expansion

Deliver:

- current-state matrix;
- target sequence diagram;
- endpoint and event catalog;
- secret and environment binding map without values;
- risk and failure-mode register;
- implementation backlog;
- sandbox and live test matrix.

Then offer one of these follow-ons:

- **Sandbox Activation Sprint:** fixed implementation scope.
- **Production Activation Sprint:** gated deployment, authenticated provider smokes, and release evidence.
- **Managed Agentic Commerce Operations:** monthly monitoring, event-delivery review, dependency updates, and quarterly recovery exercise.

## Launch gates

Do not advertise full end-to-end production fulfillment until all are verified:

1. Rename or add the exact $495 Checkout offer so the customer-facing product matches this offer.
2. Implement persistent engagement records tied to PaymentIntent and MPP receipt.
3. Add `purchase_activation_review` to MCP.
4. Implement and test authenticated Privy user and user-owned wallet routes.
5. Verify the existing Privy application's production settings and allowed origins.
6. Run a Stripe Onramp sandbox/session smoke for each marketed asset/network pair.
7. Verify `crypto.onramp_session.updated` delivery and state persistence.
8. Resolve the Stripe App `0.0.5` signed-readiness `401`.
9. Add rate limits, authentication, and CSRF/session protection to customer-facing state-changing routes.
10. Produce the required live release matrix and record whether a real payment was submitted.

Until these gates pass, market the $495 product as an architecture and activation **review**, not a guaranteed completed wallet or live Onramp deployment.
