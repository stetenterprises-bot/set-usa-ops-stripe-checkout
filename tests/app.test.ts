import { readFile } from "node:fs/promises";
import request from "supertest";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  InMemoryStripeAppEventStore,
  PostgresStripeAppEventStore
} from "../src/stripe-app.js";
import { InMemoryReadinessAssessmentStore } from "../src/readiness-assessment-store.js";
import { readinessDomains, type ReadinessAssessmentInput } from "../src/readiness-assessment.js";

const readinessInput = (): ReadinessAssessmentInput => ({
  workflow: { name: "Test agent checkout", intendedUsers: "agents", targetEnvironment: "sandbox" },
  capabilities: Object.fromEntries(readinessDomains.map((domain) => [domain, { status: "unknown" }])) as ReadinessAssessmentInput["capabilities"]
});

describe("development server", () => {
  it("redirects only a Stripe-confirmed successful payment to the public thank-you page", async () => {
    const returnScript = await readFile(new URL("../public/return.js", import.meta.url), "utf8");

    expect(returnScript).toContain('case "succeeded"');
    expect(returnScript).toContain("https://ledgerline-compliance.sthomas935.chatgpt.site/thank-you");
    expect(returnScript).toContain("window.location.replace(successfulPurchaseUrl)");
  });

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
      cryptoOnrampConfigured: false,
      cryptoEmbeddedComponentsConfigured: false,
      purchaseStoreConfigured: false,
      privyAuthenticationConfigured: false,
      purchaseApprovalConfigured: false,
      purchasingConfigured: false,
      purchasingWebhookConfigured: false,
      mppConfigured: false,
      mppPrice: { amount: "0.50", currency: "usd", unit: "readiness_assessment" },
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

  it("fails closed for the durable purchasing routes when the bridge is unconfigured", async () => {
    const app = createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" });

    const create = await request(app)
      .post("/purchasing/requests")
      .send({ cryptocurrency: "USDC" });
    expect(create.status).toBe(503);
    expect(create.body).toMatchObject({ code: "configuration_required" });
  });

  it("uses the injected orchestrator for purchasing routes and signed Onramp events", async () => {
    const webhookSecret = ["whsec", "purchasing", "unitvalue"].join("_");
    const purchase = {
      requestId: "req_app_purchase",
      state: "intake",
      version: 1,
      asset: "USDC",
      network: "base",
      sourceCurrency: "USD",
      sourceAmount: "30.00",
      destinationAmount: "25.00",
      wallet: null,
      quote: null,
      sessionId: null,
      providerStatus: null,
      deliveredAmount: null,
      transactionId: null,
      entitlement: { status: "locked", type: "verified_crypto_delivery", releasedAt: null }
    };
    const createPurchaseRequest = vi.fn().mockResolvedValue(purchase);
    const processSignedWebhook = vi.fn().mockResolvedValue({ duplicate: false, purchase });
    const orchestrator = {
      createRequest: createPurchaseRequest,
      processSignedWebhook
    } as never;
    const eventStore = { claim: vi.fn().mockResolvedValue(true) };
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeWebhookSecret: webhookSecret
    }, { purchasingOrchestrator: orchestrator, stripeAppEventStore: eventStore });

    const createResponse = await request(app)
      .post("/purchasing/requests")
      .send({ cryptocurrency: "USDC" });
    expect(createResponse.status).toBe(201);
    expect(createPurchaseRequest).toHaveBeenCalledWith({ cryptocurrency: "USDC" }, undefined);

    const payload = JSON.stringify({
      id: "evt_purchasing_onramp",
      object: "event",
      type: "crypto.onramp_session.updated",
      data: { object: { id: "cos_purchasing_session", status: "fulfillment_processing" } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const webhookResponse = await request(app)
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body).toMatchObject({ handled: true, duplicate: false, eventType: "crypto.onramp_session.updated" });
    expect(processSignedWebhook).toHaveBeenCalledWith(expect.any(Buffer), signature, webhookSecret);
    expect(eventStore.claim).not.toHaveBeenCalled();
  });

  it("serves the Components option while both crypto flows fail closed before configuration", async () => {
    const app = createApp({ port: 4242, applicationBaseUrl: "http://127.0.0.1:4242" });
    const page = await request(app).get("/crypto-fiat");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Embedded Components");
    expect(page.headers["content-security-policy"]).toContain("https://crypto-js.stripe.com");
    expect((await request(app).get("/crypto-fiat/components/config")).status).toBe(503);
    expect((await request(app).post("/crypto-fiat/components/link-auth-intent").send({})).status).toBe(503);
    expect((await request(app).get("/private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY/config")).status).toBe(503);
  });

  it("requires explicit wallet and network confirmation before minting an Onramp session", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["rk", "test", "unitvalue"].join("_"),
      stripePublishableKey: ["pk", "test", "unitvalue"].join("_"),
      stripeWebhookSecret: ["whsec", "unitvalue"].join("_"),
      agenticEventsDatabaseUrl: "postgresql://unit:unit@127.0.0.1:5432/unit"
    });
    const response = await request(app)
      .post("/private/embedded-onramp-OPoWPWqwaOqszCJaOMmp-wiY/session")
      .set("idempotency-key", "embedded-onramp-test-1")
      .send({ network: "ethereum", currency: "usdc", walletAddress: "0x0000000000000000000000000000000000000000" });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Confirm the wallet");
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
    }, { readinessAssessmentStore: new InMemoryReadinessAssessmentStore() });

    expect((await request(app).post("/stripe/accounts").send({ country: "US" })).status).toBe(404);
    expect((await request(app).post("/paid").set("idempotency-key", "assessment-live-1").send(readinessInput())).status).toBe(402);
  });

  it("challenges each paid API call for exactly 0.50 USD", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
      stripeProfileId: "profile_test_unitvalue"
    }, { readinessAssessmentStore: new InMemoryReadinessAssessmentStore() });

    const response = await request(app)
      .post("/paid")
      .set("idempotency-key", "assessment-test-1")
      .send(readinessInput());

    expect(response.status).toBe(402);
    const challenge = response.headers["www-authenticate"] as string;
    expect(challenge).toContain("Payment");
    const encodedRequest = /request="([^"]+)"/.exec(challenge)?.[1];
    expect(encodedRequest).toBeDefined();
    const paymentRequest = JSON.parse(Buffer.from(encodedRequest!, "base64url").toString("utf8"));
    expect(paymentRequest).toMatchObject({ amount: "50", currency: "usd" });
  });

  it("rejects invalid readiness input before issuing a payment challenge", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeApiKey: ["sk", "test", "unitvalue"].join("_"),
      stripeProfileId: "profile_test_unitvalue"
    }, { readinessAssessmentStore: new InMemoryReadinessAssessmentStore() });

    const response = await request(app).post("/paid").set("idempotency-key", "assessment-test-2").send({ prompt: "test" });

    expect(response.status).toBe(400);
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it("recovers an already-paid readiness artifact without issuing another challenge", async () => {
    const store = new InMemoryReadinessAssessmentStore();
    const input = readinessInput();
    await store.prepare("assessment-recovery-1", input);
    await store.recordPayment("assessment-recovery-1", {
      method: "stripe",
      reference: "pi_recovery_1",
      status: "success",
      timestamp: "2026-09-01T00:00:00.000Z"
    });
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242"
    }, { readinessAssessmentStore: store });

    const response = await request(app)
      .post("/paid/recover")
      .set("idempotency-key", "assessment-recovery-1")
      .send(input);

    expect(response.status).toBe(200);
    expect(response.headers["www-authenticate"]).toBeUndefined();
    expect(response.body).toMatchObject({ type: "agentic_commerce_readiness_assessment", receiptReference: "pi_recovery_1" });
  });

  it("verifies signed Stripe App drawer requests and returns only readiness gates", async () => {
    const signingSecret = "absec_unitvalue";
    const payload = JSON.stringify({ user_id: "usr_test", account_id: "acct_test" });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret });
    const response = await request(createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeAppSigningSecret: signingSecret,
      stripeAppWebhookSecret: ["whsec", "app", "unitvalue"].join("_")
    }))
      .post("/stripe-app/readiness")
      .set("stripe-signature", signature)
      .send({ user_id: "usr_test", account_id: "acct_test" });

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.body).toEqual({
      ok: true,
      mppConfigured: false,
      privyConfigured: false,
      checkoutConfigured: false,
      paymentWebhookConfigured: false,
      appEventsConfigured: true,
      durableEventStoreConfigured: false,
      executionAuthorized: false
    });
  });

  it("verifies sandbox drawer requests without replacing the production signing secret", async () => {
    const sandboxSigningSecret = "absec_sandbox_unitvalue";
    const payload = JSON.stringify({ user_id: "usr_sandbox", account_id: "acct_sandbox" });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: sandboxSigningSecret
    });
    const response = await request(createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeAppSigningSecret: "absec_production_unitvalue",
      stripeAppSandboxSigningSecret: sandboxSigningSecret
    }))
      .post("/stripe-app/readiness")
      .set("stripe-signature", signature)
      .send({ user_id: "usr_sandbox", account_id: "acct_sandbox" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, executionAuthorized: false });
  });

  it("fails closed for unsigned or invalid Stripe App drawer requests", async () => {
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeAppSigningSecret: "absec_unitvalue"
    });
    expect((await request(app).post("/stripe-app/readiness").send({})).status).toBe(400);
    expect((await request(app)
      .post("/stripe-app/readiness")
      .set("stripe-signature", "invalid")
      .send({ user_id: "usr_test", account_id: "acct_test" })).status).toBe(401);
  });

  it("verifies Stripe App connected-account events and suppresses duplicate reactions", async () => {
    const webhookSecret = ["whsec", "app", "unitvalue"].join("_");
    const payload = JSON.stringify({
      id: "evt_app_succeeded",
      object: "event",
      type: "payment_intent.succeeded",
      account: "acct_installer",
      livemode: false,
      data: { object: { id: "pi_app_succeeded", object: "payment_intent", status: "succeeded" } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const app = createApp({
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeAppWebhookSecret: webhookSecret
    });
    const first = await request(app)
      .post("/stripe-app/events")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    const duplicate = await request(app)
      .post("/stripe-app/events")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(first.body).toMatchObject({ received: true, handled: true, duplicate: false });
    expect(duplicate.body).toMatchObject({ received: true, handled: true, duplicate: true });
  });

  it("suppresses duplicate Stripe App reactions across app instances sharing durable storage", async () => {
    const webhookSecret = ["whsec", "app", "multiinstance"].join("_");
    const payload = JSON.stringify({
      id: "evt_app_multiinstance",
      object: "event",
      type: "payment_intent.succeeded",
      account: "acct_installer",
      livemode: false,
      data: { object: { id: "pi_app_multiinstance", object: "payment_intent", status: "succeeded" } }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const sharedStore = new InMemoryStripeAppEventStore();
    const config = {
      port: 4242,
      applicationBaseUrl: "http://127.0.0.1:4242",
      stripeAppWebhookSecret: webhookSecret
    };
    const first = await request(createApp(config, { stripeAppEventStore: sharedStore }))
      .post("/stripe-app/events")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    const duplicate = await request(createApp(config, { stripeAppEventStore: sharedStore }))
      .post("/stripe-app/events")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(first.body.duplicate).toBe(false);
    expect(duplicate.body.duplicate).toBe(true);
  });

  it("uses an atomic PostgreSQL insert to claim event IDs", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 });
    const store = new PostgresStripeAppEventStore({ query } as never);
    const event = {
      eventId: "evt_atomic",
      eventType: "payment_intent.succeeded",
      accountId: "acct_installer",
      livemode: false
    };

    expect(await store.claim(event)).toBe(true);
    expect(await store.claim(event)).toBe(false);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[0]).toContain("ON CONFLICT (event_id) DO NOTHING");
  });
});
