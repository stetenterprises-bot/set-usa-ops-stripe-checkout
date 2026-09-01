<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "Set Business Consults (USA Ops)".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->

## Static Stripe payment-method selection

When a SET payment flow explicitly disables dynamic payment methods, first report three separate layers: (1) methods verified available in the relevant live or test account configuration, (2) methods eligible for the exact currency, amount, customer location, Stripe product, and confirmation/return flow, and (3) the proposed explicit allowlist. Do not change the allowlist until the user selects it. Keep the deferred Element's `paymentMethodTypes` and the server PaymentIntent's `allowed_payment_method_types` identical. Treat Apple Pay and Google Pay as wallets presented through `card`, not standalone PaymentIntent types. Label redirect, asynchronous-settlement, customer-object, and materially different fulfillment requirements. Do not enable or infer dynamic payment methods unless the user explicitly supersedes this rule.

## Live payment release evidence gate

Before changing or deploying a live payment method, offer, amount, currency, confirmation flow, host, webhook destination, fulfillment path, or payment-gated endpoint, produce one current release matrix covering: source commit; public host and route checks; Stripe account and mode; offer amounts and currencies; account-verified payment-method availability; transaction-specific eligibility; the user-selected static allowlist; exact client/server allowlist parity; redirect, asynchronous, customer-object, and partial-funding behavior; webhook endpoint and subscribed-event coverage; durable event deduplication and idempotent fulfillment state; authenticated smoke outcome; and whether any real payment was submitted. Mark every unverified field `UNKNOWN` and do not describe the release as operationally complete while a payment-critical field remains unknown. Local experiments and test-only scaffolds may use a reduced matrix, but must remain explicitly non-live.
