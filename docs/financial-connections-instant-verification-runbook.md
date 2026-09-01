# Financial Connections instant-verification runbook

Scope: SET's USD Payment Element + PaymentIntent checkout for `us_bank_account`. The objective is to verify a US bank account through Stripe Financial Connections without manual account entry or microdeposit fallback.

## What is required

1. ACH Direct Debit must be available and enabled in the target Stripe account and mode.
2. The deferred Payment Element must set `paymentMethodOptions.us_bank_account.verification_method` to `instant`.
3. The server-created PaymentIntent must set `payment_method_options.us_bank_account.verification_method` to `instant`.
4. Both surfaces request every currently documented permission: `payment_method`, `balances`, `ownership`, and `transactions`.
5. Both surfaces prefetch every refreshable data category: `balances`, `ownership`, and `transactions`.
6. The client and server retain the selected static USD allowlist: `card`, `cashapp`, `crypto`, `us_bank_account`, `customer_balance`.
7. The hosted Payment Element collects consent for the complete requested data scope and the ACH mandate. SET must not collect bank credentials, routing numbers, or account numbers directly.
8. The browser treats `processing` as pending. Fulfillment waits for the signed `payment_intent.succeeded` webhook.
9. Stripe's Financial Connections Account `status` is the authority for active, inactive, or disconnected state. Data refreshes must not run while inactive.
10. An unsupported institution or failed bank authentication must lead to retrying Financial Connections, choosing another institution, or choosing another already-approved payment method. It must never change the verification method to `automatic` or `microdeposits`.

`instant` means instant account verification. It does not make the ACH debit settle instantly or guarantee funds.

## Customer experience without microdeposits

1. The customer opens a USD checkout and selects **US bank account**.
2. Stripe opens Financial Connections and displays the institution search/selection screen.
3. The customer selects a bank, reviews the requested payment-method, balance, ownership, and transaction-data permissions, and consents.
4. The customer authenticates with the bank through an OAuth or supported non-OAuth flow.
5. The customer selects an eligible checking or savings account.
6. Stripe returns the customer to the Payment Element, where the customer accepts the ACH mandate and submits the payment.
7. SET confirms the ConfirmationToken through a server-created PaymentIntent.
8. The browser can show `processing` or another non-terminal status and routes to the pending/return view.
9. SET waits for `payment_intent.succeeded` before fulfillment. `payment_intent.payment_failed` asks the customer for another method.

The customer does **not** see a routing/account-number fallback, wait for deposits, receive a deposit-verification prompt, or enter two deposit amounts or a descriptor code. If instant bank verification cannot complete, the bank method is not accepted.

## Step-by-step sandbox verification

### 1. Prove configuration before opening the UI

1. Run `npm run verify`.
2. Inspect `public/checkout.js` and prove the Elements configuration contains `verification_method: "instant"` for `us_bank_account`.
3. Inspect the PaymentIntent creation contract test and prove the server sends all four permissions and all three prefetch features.
4. Prove the EUR PaymentIntent has no `us_bank_account` options.
5. Search the source for `automatic`, `microdeposits`, and `verify_with_microdeposits`; none may configure or handle a fallback in this checkout.

### 2. Start the actual test-mode application

1. Use a test restricted key, matching test publishable key, and a test webhook signing secret in the ignored runtime configuration.
2. Start Stripe's local webhook forwarder for `/webhooks/stripe`.
3. Run `npm run dev` and open a USD checkout route.
4. Record the test account ID, mode, commit SHA, local route, and webhook destination. Do not record credentials or client secrets.

### 3. Successful non-OAuth connection

1. Select **US bank account**.
2. In Financial Connections, use Stripe's `Test (Non-OAuth)` or `Bank (Non-OAuth)` institution.
3. Complete institution authentication and select an eligible account.
4. Confirm that the flow returns to checkout without showing manual routing/account entry.
5. Accept the ACH mandate and submit.
6. Confirm the PaymentIntent enters `processing` or the appropriate provider-returned state; do not display “paid” solely because linking succeeded.
7. Confirm the signed webhook produces the terminal result and fulfillment occurs only for `payment_intent.succeeded`.

### 4. Successful OAuth connection

Repeat the previous test with `Test (OAuth)` or `Bank (OAuth)` and verify:

- The OAuth window opens and returns to the originating checkout.
- Closing or blocking the OAuth window is recoverable and does not mark the bank verified.
- No manual-entry or microdeposit fallback appears.

### 5. Cancellation and institution failures

Cancel at institution selection, authentication, consent, and account selection. Then exercise Stripe's test institutions for scheduled downtime, unscheduled downtime, generic error, and invalid payment accounts.

For every case, verify:

- No PaymentIntent is represented as paid.
- No fulfillment occurs.
- The customer can retry, choose another bank, or choose another method from the existing static allowlist.
- The UI never displays manual account entry or microdeposit verification.
- No Intent exposes `next_action.type = verify_with_microdeposits`.

### 6. ACH delayed outcomes

Use Stripe's documented ACH test PaymentMethods/accounts to exercise success, no account, insufficient funds, debit not authorized, indefinite processing, and dispute behavior.

Verify:

- `payment_intent.processing` renders a pending state.
- `payment_intent.succeeded` permits fulfillment exactly once.
- `payment_intent.payment_failed` never fulfills and requests another method.
- Duplicate webhook delivery cannot duplicate fulfillment.
- A pending payment cannot become successful because of a browser timeout or return-page refresh.
- Instant account verification is not represented as protection from later ACH returns or disputes.

### 7. Negative regression proof

1. Search sanitized Intent responses and logs for `verify_with_microdeposits`.
2. Confirm no customer screen asks for deposit amounts or an `SM...` descriptor code.
3. Confirm retries preserve `verification_method: "instant"`.
4. Confirm no alternative SetupIntent, Invoice, Subscription, or support procedure recreates this bank-account flow with the default `automatic` method.

Any observed microdeposit next action is a release blocker.

## Evidence packet

Retain sanitized evidence for:

- Source commit and passing verification suite.
- Target Stripe account and mode.
- Live/test payment-method configuration showing `us_bank_account` available.
- Client and server `instant` policy parity.
- Client and server full permission/prefetch parity.
- Active, inactive, reactivated, and disconnected account lifecycle evidence.
- Financial Connections OAuth and non-OAuth completion.
- An unavailable-institution path proving no manual fallback.
- Pending, succeeded, and failed PaymentIntent webhook timelines.
- Duplicate-event/idempotency proof.
- Exact statement of whether a real payment was submitted.

Do not retain bank credentials, account/routing numbers, client secrets, raw sensitive Financial Connections data, or unredacted screenshots.

## Official Stripe references

- [Financial Connections for ACH Direct Debit](https://docs.stripe.com/financial-connections/ach-direct-debit-payments)
- [Accept an ACH Direct Debit payment](https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment)
- [ACH Direct Debit behavior and timing](https://docs.stripe.com/payments/ach-direct-debit)
- [Test Financial Connections](https://docs.stripe.com/financial-connections/testing)
- [Save an ACH bank account with a SetupIntent](https://docs.stripe.com/payments/ach-direct-debit/set-up-payment)
