# SET Ledger presentation for Mr. Varney

## What the product is

SET Business Consults offers an Operations Assurance Retainer for **$195/month**. The product maintains a working SET-hosted link to the embedded Stripe onramp and provides the customer with an onboarding kit after a verified paid subscription. Signed payment events activate the client workspace and record operator follow-up.

The customer begins with Stripe Checkout. The backend verifies the returned Checkout Session against the SET seller, the retainer offer, the exact `$195 USD` amount, paid status, and the current subscription status before access is granted.

## What the customer does

The customer completes Stripe’s payment flow and any provider-required OTP, identity, or KYC steps. If a wallet workflow is separately used, the customer authenticates through Privy and confirms the customer-controlled wallet action. Customer payment credentials, KYC records, and private wallet recovery material remain with the relevant provider or customer.

Stripe and Privy are third-party services used in the workflow. They are not SET-owned technology. SET operates the service contract and integration boundary.

## What the product does not claim

The retainer is a maintenance product. It does not promise passive income, guaranteed revenue, customer funding, or a completed live crypto transaction. A paid subscription and product access do not by themselves prove that a crypto purchase, swap, bridge, dApp action, or blockchain delivery occurred.

## Discovery and separate assessment

The public MCP route, `POST /mcp`, provides read-only discovery and intake tools. The `$0.50 USD` `POST /paid` Agentic Commerce Readiness Assessment is a separate machine-paid product. It is not the `$195/month` retainer and does not grant retainer product access.

## Current verification boundary

The customer-facing return uses `/retainer/welcome?session_id=...`. The backend’s status route performs the canonical Stripe lookup and returns only the paid decision, current subscription status when available, and the approved product URL. The Site then handles the verified-paid access experience.
