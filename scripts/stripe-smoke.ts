import { loadConfig, STRIPE_API_VERSION } from "../src/config.js";
import { createStripeClient } from "../src/stripe-client.js";

const stripe = createStripeClient(loadConfig());
const account = await stripe.accounts.retrieveCurrent();

console.info(
  JSON.stringify(
    {
      ok: true,
      credentialMode: "test",
      accountId: account.id,
      apiVersion: STRIPE_API_VERSION,
      operation: "read-only account retrieval"
    },
    null,
    2
  )
);
