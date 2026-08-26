import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import Stripe from "stripe";
import { createStripeAppServer } from "./server.js";

test("serves signed readiness without authorizing execution", async (context) => {
  const secret = "absec_unitvalue";
  const server = createStripeAppServer({
    appSigningSecret: secret,
    appWebhookSecret: ["whsec", "app", "unitvalue"].join("_"),
    stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
    stripeProfileId: "profile_test_unitvalue"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const payload = JSON.stringify({ user_id: "usr_test", account_id: "acct_test" });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const response = await fetch(`http://127.0.0.1:${address.port}/stripe-app/readiness`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(body.mppConfigured, true);
  assert.equal(body.executionAuthorized, false);
});

test("fails closed when signed-request verification is not configured", async (context) => {
  const server = createStripeAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/stripe-app/readiness`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "usr_test", account_id: "acct_test" })
  });
  assert.equal(response.status, 503);
});
