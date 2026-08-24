# General Stripe Upgrade Plan

Target API version: `2026-07-29.dahlia`  
Target Node SDK: current tested project dependency (`stripe@22.5.0`)

This is a staged plan. Pinning the target in this isolated scaffold does not upgrade an existing application or the Stripe account default.

## 1. Establish the current baseline

- Record each deployed service, language/runtime, Stripe SDK, Stripe.js/mobile SDK, and explicit API-version override.
- Read the authenticated Stripe account default and list webhook endpoints with their pinned API versions.
- Inventory the Stripe APIs and event types actually used from source and request logs.
- Record test, staging, and production keys separately; prefer one least-privilege restricted key per service.

Exit evidence: a source-linked inventory with unknowns left explicit. Capability or configuration is not treated as authorization to move money.

## 2. Review breaking changes

- Compare the current version with `2026-07-29.dahlia` in Stripe's API changelog and upgrade guide.
- Classify changes by Payments, Billing, Connect, Tax, Identity, Financial Connections, Treasury, and webhook impact.
- Replace deprecated Charges, Sources, Tokens, or Card Element usage with supported APIs where present.
- Confirm database fields can store case-sensitive Stripe IDs up to 255 characters.

Exit evidence: an applicability matrix mapping each relevant breaking change to code, tests, or “not used.”

## 3. Upgrade in an isolated branch

- Upgrade the server SDK first and keep the API version explicitly pinned.
- Update generated types and compile before changing behavior.
- Update webhook parsing and make unknown event types safe and observable.
- Upgrade Stripe.js or mobile SDKs separately after the backend passes.
- For Checkout Sessions, omit `payment_method_types`; use dynamic methods and include a unique `integration_identifier` on supported API versions.

Exit evidence: clean typecheck, unit tests, build, secret scan, and reviewed dependency diff.

## 4. Test without changing the account default

- Use test credentials and the target API version in code or the `Stripe-Version` request header.
- Replay representative webhook fixtures and then validate signed events through the Stripe CLI.
- Test idempotent retries, redirects, failures, refunds, disputes, and any product-specific state transitions in scope.
- Confirm no inline catalog creation loop exists; reuse managed Product and Price IDs where Checkout requires catalog objects.

Exit evidence: test-mode object IDs, request logs, event IDs, and pass/fail results clearly labeled as non-production evidence.

## 5. Controlled rollout

- Deploy to a non-production environment with the explicit target version.
- Run authorized provider smoke tests and compare response/event schemas with the baseline.
- Roll services forward one at a time; retain rollback artifacts and the prior working SDK lockfile.
- Change webhook endpoint versions and the account default only after all consumers are compatible and an authorized human approves the change.

Exit evidence: deployment record, monitoring window, rollback decision, and named approver.

## 6. Post-upgrade verification

- Monitor Stripe request logs, webhook delivery failures, `403` permission errors, payment failures, and schema-validation errors.
- Tighten restricted-key permissions based on observed calls.
- Rotate superseded credentials only after the new path is stable.
- Document the final SDK/API versions and next scheduled review.

## Current status

- `[V]` The isolated local scaffold targets `2026-07-29.dahlia` with `stripe@22.5.0`.
- `[V]` Local unauthenticated verification can run without provider access.
- `[I]` No existing SET integration was found in this workspace, so there is no source baseline to migrate yet.
- `[I]` Authenticated account, webhook, Stripe.js, mobile, and deployed-service versions remain unknown.
- `[D]` No Stripe account default, webhook endpoint, key, or provider object has been changed.

