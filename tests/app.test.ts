import request from "supertest";
import { describe, expect, it } from "vitest";
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
      mppPrice: { amount: "0.50", currency: "usd", unit: "api_call" }
    });
  });

  it("fails closed when webhook verification is not configured", async () => {
    const response = await request(createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" }))
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(503);
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
    expect((await request(app).post("/checkout/confirm-intent").send({ confirmationTokenId: "ct_test_example" })).status).toBe(503);
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
      .send({ confirmationTokenId: "not-a-token" });

    expect(response.status).toBe(400);
  });

  it("does not expose sandbox-only account routes in live mode", async () => {
    const app = createApp({
      port: 4242,
      stripeMode: "live",
      applicationBaseUrl: "https://checkout.example.com",
      stripeApiKey: ["rk", "live", "unitvalue"].join("_"),
      stripePublishableKey: ["pk", "live", "unitvalue"].join("_"),
      stripeWebhookSecret: ["whsec", "unitvalue"].join("_")
    });

    expect((await request(app).post("/stripe/accounts").send({ country: "US" })).status).toBe(404);
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
