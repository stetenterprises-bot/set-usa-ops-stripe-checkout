# Execution flow

Use this reference for implementation or live/sandbox execution. Recheck current Stripe and Privy primary documentation before coding against their APIs.

## Provider roles

| Component | Responsibility | Must not do |
|---|---|---|
| SET backend | Validate intake, authenticate the user, coordinate APIs, bind idempotency, verify status, return non-secret evidence | Hold customer fiat or crypto, select a trade without consent, store wallet recovery material |
| Privy | Authenticate the user, create or retrieve the user-owned wallet, provide wallet access/recovery/connectors | Make SET the wallet owner when the customer is intended to control it |
| Stripe Onramp | Present KYC and payment UI, collect fiat, purchase crypto, deliver it to the supplied public wallet address, report status | Send funds to a network/address not confirmed for the requested asset |
| User | Confirm wallet/network, complete Stripe KYC/payment, authorize any later wallet signature | Share a seed phrase or private key with SET or the agent |

Stripe states that it acts as merchant of record for the onramp. This is provider responsibility, not evidence that SET may custody funds or execute exchange activity outside the onramp.

## Privy resource gate

Expected project resource locator:

```text
cmt7hoxq900i20cl79s3r6sva
```

Verify it through `stripe projects status --json`. Do not infer its resource kind from the prefix and do not substitute a catalog provider/service ID. If Stripe Projects reports `NOT_AUTHENTICATED`, require the user to complete `stripe projects init` in an interactive terminal; do not loop authentication attempts. If the resource is absent, ask whether to link or provision Privy before running any add command. Catalog verification must precede provisioning, and paid plans require an explicit pricing decision.

Current catalog evidence observed on 2026-08-24 listed Privy Free, Core, Scale, Enterprise, and a project-level `Privy/app` deployable. This is discovery evidence only; refresh it before selection. Do not silently select Core merely because its description mentions fiat onramp.

## Normalized intake record

Keep secrets and regulated identity data out of the record.

```json
{
  "request_id": "server-generated opaque ID",
  "destination_asset": "normalized asset code",
  "destination_network": "explicit network",
  "destination_amount": "decimal string",
  "source_currency": "ISO 4217 lowercase code",
  "source_budget": "decimal string",
  "post_purchase_intent": "none | swap | dex | dapp | other",
  "privy_user_id": "authenticated provider reference",
  "wallet_address": "public address after confirmation",
  "wallet_chain_type": "provider chain type",
  "onramp_mode": "sandbox | live",
  "approval_state": "intake | wallet_confirmed | onramp_confirmed | user_payment | fulfilled | failed"
}
```

Use decimal strings at boundaries. Apply asset- and currency-specific precision rules before provider calls. Never use floating-point arithmetic for money or token quantities.

## Wallet creation

Use Privy’s authenticated user model. Client-created wallets automatically belong to the authenticated user. When using the server API, set the Privy user as owner; an authorization-key owner creates an app-controlled wallet and is not the default requested model.

Select the chain type only after mapping the requested Stripe destination asset/network pair. Examples such as ETH can exist on multiple EVM networks; USDC exists on multiple networks. The ticker alone is insufficient.

Persist only the Privy user reference, wallet ID, public address, chain type, creation timestamp, and correlation ID. Do not persist private keys or seed phrases. If an existing compatible wallet is reused, display the full public address and require the user to confirm it.

## Stripe Onramp session

Create one server-side Onramp session for the confirmed request. Use a least-privilege environment-specific Stripe key. Supply the correct public wallet under the network key and, when supported and confirmed, lock the destination asset/network and source or destination amount.

Return only the session client secret to the authenticated client over TLS and only for initializing Stripe’s onramp component. Never log, cache in analytics, or include it in completion evidence. Load Stripe client libraries from Stripe-hosted domains and use a restrictive Content Security Policy.

The user completes KYC, payment-method entry, and final purchase confirmation in Stripe UI. SET’s backend must not proxy raw card or bank credentials.

## Verification and failure handling

Verify Stripe webhook signatures before accepting state changes. Make fulfillment handling idempotent. Store event ID, session ID, provider status, transaction ID, public wallet address, network, delivered asset/amount, and timestamps.

- `initialized` or equivalent: no payment claim.
- payment submitted or processing: pending, not delivered.
- fulfilled with transaction identifier: provider-confirmed completion.
- failed, rejected, expired, or canceled: no success handoff; show the provider-safe reason and next permitted action.

Do not create a replacement wallet or duplicate Onramp session automatically after an ambiguous timeout. Reconcile the existing session first.

## Access and connector handoff

Explain how the user returns through the same Privy authentication method, enables recovery and MFA, views the address/balance, and uses Privy-supported connection tooling for the wallet’s chain. Verify connector names from current Privy documentation at handoff time; typical destinations include EVM wallet clients and Solana wallet clients, but support changes.

Privy supports an authenticated export flow for eligible user-owned embedded wallets. The user invokes export in Privy’s secure UI. Never ask them to paste the exported key into chat, logs, or application support.

## Separate swap or dApp gate

For a swap, bridge, DEX, or dApp request, prepare a new transaction packet containing:

- exact chain and wallet;
- input token and maximum spend;
- output token and minimum received;
- route/venue and contract addresses;
- price impact, fees, slippage, allowance, deadline, and simulation result;
- whether a token approval is unlimited or exact-amount;
- explicit user confirmation state.

Prefer exact-amount approvals. No wallet signature occurs until the user approves that packet. A successful onramp is not permission for the follow-on transaction.
