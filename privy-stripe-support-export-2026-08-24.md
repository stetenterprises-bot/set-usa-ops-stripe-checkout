# Privy / Stripe Support Request Export

Date of failed setups: August 24, 2026
Project: Set Business Consults (USA Ops)
Purpose: Support ticket/chat regarding attachment of an existing Privy account through Stripe Projects

## Support-ready summary

We attempted to link the existing Privy organization/account to the Stripe project. The project was authenticated and initialized. We did not create a duplicate Privy organization, Privy wallet, Stripe Embedded Onramp session, payment, or crypto purchase.

The final provider response was an existing-account collision. Please provide an existing-account attachment or migration route for the already-existing Privy account rather than provisioning a duplicate.

## Failed setups in sequence

### 1. Link attempt without required provider configuration

- Command: `npx stripe projects link privy`
- Result: `CONFIGURATION_REQUIRED`
- Detail: Privy required the `account_name` provider configuration.
- Provider request number: **Not returned** (CLI validation/configuration gate)

### 2. Link attempt with account name

- Command: `npx stripe projects link privy --config '{"account_name":"Set Business Consults"}'`
- Result: `TOS_ACCEPTANCE_REQUIRED`
- Detail: Privy required acceptance of its terms and privacy policy. Acceptance was subsequently provided explicitly.
- Provider request number: **Not returned** (terms-acceptance gate)

### 3. Provider link attempt after terms acceptance

- Command: `npx stripe projects link privy --config '{"account_name":"Set Business Consults"}' --accept-tos --json`
- Result: `provider_failure`
- HTTP status: `400`
- Provider message: `An account already exists for this email address.`
- Request number: `req_v2z3pYF7k4zOG185I`

### 4. Exact existing-resource retry

- Command: `npx stripe projects link privy --config '{"account_name":"Set Business Consults"}' --accept-tos --json`
- Result: `provider_failure`
- HTTP status: `400`
- Provider message: `An account already exists for this email address.`
- Request number: `req_v2S0bD059v2DZCa89`

## Request numbers for reference

1. `req_v2z3pYF7k4zOG185I`
2. `req_v2S0bD059v2DZCa89`

## Current verified outcome

- Stripe Projects authentication: verified
- Stripe project initialization: verified
- Privy provider attachment: not completed
- Existing Privy account: provider reports an account already exists for the project email
- Duplicate Privy provisioning: not performed
- Wallet/onramp/payment activity: not performed

## Requested support action

Please locate the existing Privy account using the request numbers above and attach or migrate that existing account to the Stripe project `Set Business Consults (USA Ops)`. Do not create a second Privy organization for the same account/email.

## Evidence provenance

Recovered from the August 24, 2026 raw Codex session evidence for the USA Ops project. The export excludes credentials, email addresses, provider payloads, and other unnecessary sensitive data.
