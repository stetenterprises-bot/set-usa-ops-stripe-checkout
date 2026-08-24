import { loadConfig, STRIPE_API_VERSION } from "../src/config.js";
import { createStripeClient } from "../src/stripe-client.js";

const config = loadConfig();
const stripe = createStripeClient(config);
const account = await stripe.accounts.retrieveCurrent();

console.info(
  JSON.stringify(
    {
      ok: true,
      credentialMode: config.stripeMode ?? "test",
      accountId: account.id,
      apiVersion: STRIPE_API_VERSION,
      operation: "read-only account retrieval"
    },
    null,
    2
  )
);
