import request from "supertest";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("development server", () => {
  it("reports test-only readiness without exposing secrets", async () => {
    const response = await request(createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" })).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      mode: "test",
      stripeApiVersion: "2026-07-29.dahlia",
      stripeConfigured: false,
      checkoutConfigured: false,
      webhookConfigured: false,
      mppConfigured: false,
      mppPrice: { amount: "0.50", currency: "usd", unit: "api_call" },
      privyConfigured: false,
      privy: {
        apiBaseUrl: "https://api.privy.io",
        chain: "base",
        chainId: 8453
      }
    });
  });

  it("fails closed when webhook verification is not configured", async () => {
    const response = await request(createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" }))
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(503);
  });

  it("verifies and classifies PaymentIntent webhook events", async () => {
    const webhookSecret = ["whsec", "unitvalue"].join("_");
    const payload = JSON.stringify({
      id: "evt_test_succeeded",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_test_succeeded", object: "payment_intent", status: "succeeded" } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await request(createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeWebhookSecret: webhookSecret
    }))
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, handled: true, eventType: "payment_intent.succeeded" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"paymentIntentId":"pi_test_succeeded"'));
    log.mockRestore();
  });

  it("fails closed when the paid API is not configured", async () => {
    const response = await request(createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" }))
      .post("/paid")
      .send({});

    expect(response.status).toBe(503);
  });

  it("serves the embedded Checkout page with a restrictive Stripe CSP", async () => {
    const response = await request(createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" }))
      .get("/checkout");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Workflow Improvement Review");
    expect(response.headers["content-security-policy"]).toContain("https://js.stripe.com");
    expect(response.headers["content-security-policy"]).not.toContain("default-src *");
  });

  it("fails closed when embedded Checkout credentials are not configured", async () => {
    const app = createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" });
    expect((await request(app).get("/checkout/config")).status).toBe(503);
    expect((await request(app).post("/checkout/confirm-intent").send({ confirmationTokenId: "ct_test_example", customerEmail: "buyer@example.com" })).status).toBe(503);
  });

  it("returns server-authoritative static offer configurations", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
    });

    const usd = await request(app).get("/checkout/workflow-improvement-review-297-usd/config");
    expect(usd.status).toBe(200);
    expect(usd.body.offer).toEqual(expect.objectContaining({
      amount: 29_700,
      currency: "usd",
      paymentMethodTypes: ["card", "cashapp", "crypto", "us_bank_account", "customer_balance"]
    }));

    const eur = await request(app).get("/checkout/workflow-improvement-review-297-eur/config");
    expect(eur.status).toBe(200);
    expect(eur.body.offer).toEqual(expect.objectContaining({
      amount: 29_700,
      currency: "eur",
      paymentMethodTypes: ["card", "bizum", "eps", "mb_way", "multibanco"]
    }));
    expect(eur.body.offer.paymentMethodTypes).not.toContain("cashapp");
    expect(eur.body.offer.paymentMethodTypes).not.toContain("crypto");
  });

  it("rejects unknown checkout offers", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
    });

    expect((await request(app).get("/checkout/not-an-offer/config")).status).toBe(404);
    expect((await request(app).post("/checkout/not-an-offer/confirm-intent").send({})).status).toBe(404);
  });

  it("rejects malformed ConfirmationToken IDs before calling Stripe", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
      stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
    });

    const response = await request(app)
      .post("/checkout/confirm-intent")
      .send({ confirmationTokenId: "not-a-token", customerEmail: "buyer@example.com" });

    expect(response.status).toBe(400);
  });

  it("requires a valid fulfillment email before calling Stripe", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
      stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
    });

    const response = await request(app)
      .post("/checkout/confirm-intent")
      .send({ confirmationTokenId: "ct_test_example", customerEmail: "not-an-email" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("valid customer email");
  });

  it("does not expose sandbox-only account routes in live mode", async () => {
    const app = createApp({
      port: 4242,
      stripeMode: "live",
      applicationBaseUrl: "https://checkout.example.com",
      stripeApiKey: ["rk", "live", "unitvalue"].join("_"),
      stripePublishableKey: ["pk", "live", "unitvalue"].join("_"),
      stripeWebhookSecret: ["whsec", "unitvalue"].join("_"),
      stripeProfileId: "profile_unitvalue"
    });

    expect((await request(app).post("/stripe/accounts").send({ country: "US" })).status).toBe(404);
    expect((await request(app).post("/paid").send({ prompt: "test" })).status).toBe(402);
  });

  it("challenges each paid API call for exactly 0.50 USD", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
      stripeProfileId: "profile_test_unitvalue"
    });

    const response = await request(app).post("/paid").send({ prompt: "test" });

    expect(response.status).toBe(402);
    const challenge = response.headers["www-authenticate"] as string;
    expect(challenge).toContain("Payment");
    const encodedRequest = /request="([^"]+)"/.exec(challenge)?.[1];
    expect(encodedRequest).toBeDefined();
    const paymentRequest = JSON.parse(Buffer.from(encodedRequest!, "base64url").toString("utf8"));
    expect(paymentRequest).toMatchObject({ amount: "50", currency: "usd" });
  });
});
