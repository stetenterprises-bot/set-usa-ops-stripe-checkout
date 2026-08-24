import express, { type Request, type Response } from "express";
import crypto from "node:crypto";
import { Mppx, discovery } from "mppx/express";
import { stripe as stripeMachinePayments } from "mppx/server";
import Stripe from "stripe";
import { join } from "node:path";
import { STRIPE_API_VERSION, type RuntimeConfig } from "./config.js";
import { createStripeIntegration } from "./stripe-integration.js";
import { createJsonResourceStore } from "./resource-store.js";

export function createApp(config: RuntimeConfig): express.Express {
  const app = express();
  const stripeMode = config.stripeMode ?? "test";
  const stripe = config.stripeApiKey ? new Stripe(config.stripeApiKey, { apiVersion: STRIPE_API_VERSION }) : undefined;
  const integration = stripe ? createStripeIntegration(stripe, config, createJsonResourceStore(".data/stripe-resources.json")) : undefined;
  const testIntegration = stripeMode === "test" ? integration : undefined;
  const machinePayments = stripeMode === "test" && stripe && config.stripeProfileId
    ? stripeMachinePayments.create({
        client: stripe,
        networkId: config.stripeProfileId,
        livemode: false,
        metadata: { integration: "set-usa-ops-mpp" }
      })
    : undefined;
  const mppx = machinePayments && config.stripeApiKey
    ? Mppx.create({
        methods: [machinePayments.spt.charge()],
        realm: new URL(config.applicationBaseUrl).hostname,
        secretKey: config.mppSecretKey ?? crypto
          .createHmac("sha256", config.stripeApiKey)
          .update("mpp-challenge-signing")
          .digest("base64")
      })
    : undefined;
  const paidApi = mppx?.charge({
    amount: "0.50",
    currency: "usd",
    decimals: 2,
    description: "SET USA Ops API call",
    scope: "POST /paid"
  });

  app.disable("x-powered-by");
  const publicDirectory = join(process.cwd(), "public");

  app.use((_request, response, next) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com https://*.link.com; connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.link.com; img-src 'self' data: https://*.stripe.com https://*.link.com; style-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/health", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      mode: stripeMode,
      stripeApiVersion: STRIPE_API_VERSION,
      stripeConfigured: Boolean(config.stripeApiKey),
      checkoutConfigured: Boolean(config.stripeApiKey && config.stripePublishableKey),
      webhookConfigured: Boolean(config.stripeWebhookSecret),
      mppConfigured: Boolean(paidApi),
      mppPrice: { amount: "0.50", currency: "usd", unit: "api_call" }
    });
  });

  app.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    (request: Request, response: Response) => {
      if (!config.stripeWebhookSecret) {
        response.status(503).json({ error: "Stripe webhook verification is not configured." });
        return;
      }

      const signature = request.header("stripe-signature");
      if (!signature) {
        response.status(400).json({ error: "Missing Stripe-Signature header." });
        return;
      }

      try {
        const event = Stripe.webhooks.constructEvent(
          request.body as Buffer,
          signature,
          config.stripeWebhookSecret
        );

        // Route recognized event types here. Unknown events are acknowledged safely.
        response.status(200).json({ received: true, eventId: event.id, eventType: event.type });
      } catch {
        response.status(400).json({ error: "Invalid Stripe webhook signature." });
      }
    }
  );

  app.use(express.json({ limit: "100kb" }));
  app.use("/assets", express.static(publicDirectory, { index: false, fallthrough: false }));

  app.get("/checkout", (_request, response) => {
    response.sendFile(join(publicDirectory, "checkout.html"));
  });

  app.get("/checkout/config", (_request, response) => {
    if (!config.stripePublishableKey) {
      return response.status(503).json({ error: "Stripe test publishable key is not configured." });
    }
    return response.json({ publishableKey: config.stripePublishableKey });
  });

  app.post("/checkout/session", async (request, response) => {
    if (!integration || !config.stripePublishableKey) {
      return response.status(503).json({ error: "Stripe test checkout credentials are not configured." });
    }
    const suppliedKey = request.header("idempotency-key");
    if (suppliedKey && !/^[A-Za-z0-9_-]{8,200}$/.test(suppliedKey)) {
      return response.status(400).json({ error: "Idempotency-Key must contain 8-200 URL-safe characters." });
    }
    const idempotencyKey = suppliedKey ?? `set-checkout-${crypto.randomUUID()}`;
    try {
      const session = await integration.createEmbeddedCheckoutSession(idempotencyKey);
      if (!session.client_secret) {
        return response.status(502).json({ error: "Stripe did not return a Checkout client secret." });
      }
      return response.status(201).json({ client_secret: session.client_secret });
    } catch {
      return response.status(502).json({ error: "Stripe Checkout Session creation failed." });
    }
  });

  app.get("/checkout/session/:sessionId", async (request, response) => {
    if (!integration) {
      return response.status(503).json({ error: "Stripe test credentials are not configured." });
    }
    const expectedSessionPrefix = stripeMode === "live" ? "cs_live_" : "cs_test_";
    if (!request.params.sessionId.startsWith(expectedSessionPrefix) || !/^[A-Za-z0-9_]+$/.test(request.params.sessionId)) {
      return response.status(400).json({ error: "Invalid Checkout Session ID for the configured mode." });
    }
    try {
      const session = await integration.retrieveCheckoutSession(request.params.sessionId);
      return response.json({
        id: session.id,
        status: session.status,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email ?? null
      });
    } catch {
      return response.status(502).json({ error: "Stripe Checkout Session lookup failed." });
    }
  });

  app.get("/checkout/return", (_request, response) => {
    response.sendFile(join(publicDirectory, "return.html"));
  });

  app.get("/", (_request, response) => {
    response.json({
      service: "SET USA Ops paid API",
      paidEndpoint: "POST /paid",
      discovery: "/openapi.json",
      price: { amount: "0.50", currency: "usd", unit: "api_call" }
    });
  });

  if (mppx && paidApi) {
    discovery(app, mppx, {
      info: { title: "SET USA Ops paid API", version: "1.0.0" },
      routes: [{
        method: "POST",
        path: "/paid",
        handler: paidApi,
        summary: "Return one payment-gated API response",
        requestBody: { type: "object", additionalProperties: true }
      }]
    });

    app.post("/paid", paidApi, (request, response) => {
      response.json({
        data: "Payment authorized.",
        request: request.body ?? null
      });
    });
  } else {
    app.get("/openapi.json", (_request, response) => {
      response.status(503).json({ error: "MPP is not configured." });
    });
    app.post("/paid", (_request, response) => {
      response.status(503).json({ error: "MPP sandbox credentials are not configured." });
    });
  }

  app.post("/stripe/accounts", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    const country = typeof request.body?.country === "string" ? request.body.country.toUpperCase() : "US";
    if (!/^[A-Z]{2}$/.test(country)) return response.status(400).json({ error: "country must be a two-letter ISO country code." });
    try { return response.status(201).json(await testIntegration.createConnectedAccount(country)); }
    catch { return response.status(502).json({ error: "Stripe account creation failed." }); }
  });

  app.post("/stripe/accounts/:accountId/onboarding-link", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    try { return response.status(201).json(await testIntegration.createOnboardingLink(request.params.accountId)); }
    catch { return response.status(502).json({ error: "Stripe onboarding-link creation failed." }); }
  });

  app.post("/stripe/accounts/:accountId/checkout-session", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    const currency = typeof request.body?.currency === "string" ? request.body.currency.toLowerCase() : "usd";
    try { return response.status(201).json(await testIntegration.createCheckoutSession(request.params.accountId, currency)); }
    catch { return response.status(502).json({ error: "Stripe Checkout Session creation failed." }); }
  });

  app.post("/stripe/subscription-plan", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    const currency = typeof request.body?.currency === "string" ? request.body.currency.toLowerCase() : "usd";
    try { return response.status(201).json(await testIntegration.createSubscriptionPlan(currency)); }
    catch { return response.status(502).json({ error: "Stripe subscription plan creation failed." });
    }
  });

  app.post("/stripe/accounts/:accountId/setup-intent", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    try { return response.status(201).json(await testIntegration.createBalanceSetupIntent(request.params.accountId)); }
    catch { return response.status(502).json({ error: "Stripe SetupIntent creation failed." }); }
  });

  app.post("/stripe/accounts/:accountId/subscription", async (request, response) => {
    if (!testIntegration) return response.status(404).json({ error: "Sandbox-only Stripe route is unavailable." });
    const { priceId, paymentMethodId } = request.body ?? {};
    if (typeof priceId !== "string" || typeof paymentMethodId !== "string") {
      return response.status(400).json({ error: "priceId and paymentMethodId are required." });
    }
    try { return response.status(201).json(await testIntegration.createAccountSubscription(request.params.accountId, priceId, paymentMethodId)); }
    catch { return response.status(502).json({ error: "Stripe subscription creation failed." }); }
  });

  return app;
}
