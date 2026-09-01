# SET release matrix — Financial Connections with manual fallback

Checked: 2026-09-01 America/Chicago

Scope: change the USD `us_bank_account` verification policy from Financial Connections-only `instant` verification to `automatic`: Financial Connections first, then manual routing/account-number entry and Stripe-hosted microdeposit verification when instant verification cannot complete. The selected payment-method allowlists do not change.

## Three-layer payment-method decision

1. **Account availability:** the current live default Payment Method Configuration reports `us_bank_account` available and on. The existing USD forms already present US bank account.
2. **Transaction eligibility:** USD currency, customer location, institution support, checking/savings eligibility, customer consent, and provider risk checks remain transaction-specific. Manual entry cannot guarantee that a submitted account will accept the debit.
3. **Selected allowlists:** unchanged. USD remains `card`, `cashapp`, `crypto`, `us_bank_account`, and `customer_balance`; EUR remains `card`, `bizum`, `eps`, `mb_way`, and `multibanco`.

## Release gates

| Gate | Evidence | State |
|---|---|---|
| Source policy | Deferred Elements and the server PaymentIntent both set `us_bank_account.verification_method` to `automatic`. | VERIFIED LOCAL |
| Financial Connections data | Instant-linked accounts still request `payment_method`, `balances`, `ownership`, and `transactions`, and prefetch balances, ownership, and transactions. | VERIFIED LOCAL |
| Manual fallback | Stripe documents `automatic` as Financial Connections with manual account entry and microdeposit fallback. | VERIFIED CURRENT DOCUMENTATION |
| Data limitation | Accounts linked by manual entry and microdeposits do not provide Financial Connections balances, ownership, or transactions. | VERIFIED CURRENT DOCUMENTATION |
| Microdeposit variants | Stripe documents a default single $0.01 `SM…` descriptor-code flow and a two-amount `ACCTVERIFY` flow. The PaymentIntent verification policy does not expose a setting that guarantees the two-amount variant. | VERIFIED PROVIDER CONTROL |
| Live timing | Stripe documents 1–2 business days for live microdeposits to appear. | VERIFIED CURRENT DOCUMENTATION |
| Customer completion | The customer must return through Stripe's hosted verification link/UI and supply the requested descriptor code or amounts. | VERIFIED DESIGN; LIVE OUTCOME UNKNOWN |
| Settlement | Account verification does not make ACH settlement instant. Payment fulfillment still waits for signed `payment_intent.succeeded`. | VERIFIED DESIGN |
| Webhooks | Existing PaymentIntent lifecycle subscriptions remain applicable. Financial Connections lifecycle/data events apply only when an account was linked through Financial Connections. | VERIFIED CONFIGURATION |
| Local verification | Pending after source change. | PENDING |
| Production deployment | The currently deployed release still uses `instant`; this fallback change is not committed, pushed, or deployed. | NOT DEPLOYED |
| Real payment or bank data | No bank account, microdeposit, or payment was submitted for this change. | VERIFIED NONE |

## Production credential requirements

- Store a live restricted key in Render's encrypted environment when it can cover the exact API calls; use a full live secret key only if a verified required call cannot be granted to the restricted key.
- Keep the matching live publishable key client-visible and the secret/restricted key server-only.
- Preserve the existing live webhook signing secret separately.
- Keep `NODE_ENV=production`, `STRIPE_MODE=live`, and the HTTPS `APPLICATION_BASE_URL`.
- Verify required key permissions in test mode first, then mirror them in live mode.
- Never commit, print, log, or send a live key through the browser or repository.

## Decision

The local change maximizes account-verification coverage without altering the selected payment methods. It cannot promise two real-time deposits: live ACH microdeposits are asynchronous and Stripe controls whether verification uses a descriptor code or two amounts.
