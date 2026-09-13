# Current payments release gate

This document separates the current live customer contract from historical release notes and disabled blueprint work.

## Current customer contract

- Product: Operations Assurance Retainer, **$195 USD/month**.
- Checkout: `POST /retainer/checkout-session` with explicit retainer-scope consent and an idempotency key.
- Return: `https://ledgerline-compliance.sthomas935.chatgpt.site/retainer/welcome?session_id={CHECKOUT_SESSION_ID}`.
- Canonical payment check: `GET /retainer/checkout-session/:sessionId/status`.
- Access condition: the status route must verify the matching Stripe mode, SET seller and retainer offer metadata, exact `$195 USD`, `payment_status: paid`, and an active or trialing expanded subscription.
- Access output: `paid`, optional `subscriptionStatus`, and the approved product URL only. Customer IDs and email addresses are excluded.
- Provider boundary: Stripe handles Checkout/Billing and the hosted payment flow; Privy handles its configured authentication or wallet relationship where the customer workflow uses it. Neither provider is SET-owned technology.

## Customer and fulfillment boundary

The customer supplies authentication, OTP or other provider verification, KYC information, payment details, and any customer-controlled wallet confirmation to the relevant provider. The current release evidence does not include a completed live final crypto transaction. Product access after verified payment is separate from any crypto acquisition, swap, bridge, dApp action, signature, or SET execution-wallet activity.

`POST /mcp` is read-only discovery/intake. `POST /paid` is a separate `$0.50 USD` Agentic Commerce Readiness Assessment with its own payment and idempotency contract. Neither substitutes for retainer payment.

## Historical material

Older README sections, release matrices, and blueprint routes may describe `$495` review work, PaymentIntent offers, connected accounts, subscription-development routes, or a SET execution-wallet architecture. Those records are historical or separately gated. They are not the current retainer price, do not establish current customer revenue or funding, and do not prove a live crypto delivery.

## Evidence language

Use “verified paid subscription” only after the canonical status route returns `paid: true`. Use “product access granted” only after the Site entitlement flow confirms the access result. Do not claim passive revenue, a custom domain, customer funding, or a completed live blockchain transaction from checkout creation, a browser return, or a configured provider resource alone.
