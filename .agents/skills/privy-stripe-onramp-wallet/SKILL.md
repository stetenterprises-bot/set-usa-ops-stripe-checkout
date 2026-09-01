---
name: privy-stripe-onramp-wallet
description: Guide a SET Business Consults user from a crypto purchase request through a user-owned Privy wallet and Stripe Embedded Onramp delivery. Use only in this project for fiat-to-crypto acquisition, wallet access, and a separately approved swap or dApp handoff. Do not use for autonomous trading, app-controlled custody, offramps, or unrelated wallet work.
---

# Privy Stripe Onramp Wallet

Build a customer-authorized, non-custodial acquisition flow. Privy supplies the authenticated user-owned wallet. Stripe supplies the onramp, KYC/payment collection, purchase, and delivery. SET coordinates the workflow and returns verified completion evidence; it does not receive customer fiat, private keys, or crypto.

Read [references/execution-flow.md](references/execution-flow.md) before implementing or executing the flow.

## Verify the project boundary

1. Work only in the initialized Stripe project **Set Business Consults (USA Ops)**.
2. Run `npx stripe projects llm-context`, then `npx stripe projects status --json`. Use the project CLI; never read or edit `.projects` or `.env` directly.
3. Require an active Privy project resource whose exact identifier is `cmt7hoxq900i20cl79s3r6sva`. Treat this identifier as a resource locator, never as a credential. If status cannot verify it, stop before wallet or payment activity and report the exact authentication or resource blocker.
4. Use `npx stripe projects env` only for redacted variable names. Pull or rotate credentials only when the user explicitly asks. Never print credential values.
5. Verify current Stripe Onramp access, mode, supported asset/network pair, geography, and transaction constraints from Stripe primary documentation or authenticated read-only account state. Availability is not execution authorization.

## Route Stripe MCP and portable agent access

- When the official Stripe plugin/MCP is available, use it for current Stripe documentation and authenticated, read-only account evidence. Select the exact Stripe account context and mode explicitly. Continue to use the repository-local Stripe Projects CLI as the authority for Privy provider, plan, app attachment, and environment state.
- The SET hosted agent surface is a tool-only MCP server at `https://set-business-consults-mpp.onrender.com/mcp`. Verify the endpoint and inspect its tool annotations before relying on it. Its readiness and intake tools are non-executing and must return `executionAuthorized: false`.
- A working Stripe MCP connection, an installed Codex plugin, and a reachable SET MCP endpoint are separate gates. None proves that Privy credentials are attached or that a wallet, Onramp session, payment, signature, swap, or dApp action is authorized.

## Report readiness in separate gates

At the start of an implementation or execution request, report these states separately: plugin installation, Stripe account/mode/permission, Stripe Projects authentication, Privy provider link, required plan, exact Privy app attachment, runtime credentials, and transaction authorization. Never collapse an installed or connected capability into a claim that wallet or payment execution is ready. Proceed only through the layers that current evidence verifies.

After installing or updating a plugin, require a new-thread registry check before relying on newly added skills or tools. If an existing Privy account causes provider linking to fail, update the CLI when appropriate and retry the exact existing-resource path once. Preserve provider request IDs, route the unresolved failure to provider support, and do not create a duplicate Privy organization or substitute a different app. Keep intake-only invocations concise: show the full matrix only when readiness, implementation, or execution is requested.

## Guided intake

Ask these questions one at a time and preserve the answers verbatim alongside normalized values:

1. **What cryptocurrency do you need to finish this with today?**
2. **How much of that cryptocurrency do you need?**
3. **How much and in what currency are you paying?**
4. **Do you need anything else after the crypto reaches your wallet, such as a swap, DEX, or dApp action?**

After question 4, resolve any missing network, source-currency, destination-currency, amount, geography, or user-authentication detail. Never silently choose a network from a ticker. If the crypto target and fiat budget cannot both be satisfied, obtain a current quote and show the discrepancy before proceeding.

## Execution sequence

Use this order because the onramp session needs a destination wallet:

`intake -> user authentication -> create/reuse user-owned Privy wallet -> quote and final review -> Stripe Onramp session -> user completes Stripe payment/KYC -> verify delivery -> access and connector handoff`

- Prefer an existing compatible wallet owned by the authenticated Privy user when the user confirms it. Otherwise create a wallet whose owner is that Privy user, never an application authorization key.
- Require explicit confirmation immediately before creating a new wallet or Onramp session. The user personally completes payment, KYC, consent, and wallet authorization in provider UI.
- Pass only the public wallet address and correct network to the Onramp session. The backend never collects fiat or card/bank credentials; Stripe does.
- Do not log or return Stripe secret keys, Privy secrets, Onramp client secrets, access tokens, private keys, seed phrases, recovery material, or full KYC data.
- Bind the request to a server-generated correlation ID and idempotency key. Validate amounts and asset/network pairs server-side.
- Treat a submitted payment as pending until a verified Stripe status or signed webhook reports fulfillment. When possible, corroborate delivery with the transaction hash or a read-only chain lookup.

## Optional post-purchase work

Question 4 records intent; it does not authorize a swap, approval, signature, bridge, DEX trade, or dApp interaction. For any follow-on action, present the network, asset pair, venue, quote, minimum received, fees, allowance/approval, contract or recipient, and expiry. Require a new explicit user authorization before requesting a wallet signature.

## Completion handoff

Return only non-secret completion data:

- wallet address and network;
- Privy wallet/user reference when safe to disclose;
- requested asset and amount, actual delivered amount, and fiat charged;
- Stripe Onramp session status and blockchain transaction identifier;
- how the user signs in to Privy again and configures recovery/MFA;
- current, provider-supported connector options for the wallet’s network;
- the separately gated next action, if requested.

Never expose or ask the user to paste a private key or seed phrase. Offer Privy’s authenticated export UI as the self-custody escape hatch when supported, and explain that export is completed by the user in Privy’s secure interface.
