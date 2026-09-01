import express, { type Request, type Response } from "express";
import crypto from "node:crypto";
import { Mppx, discovery } from "mppx/express";
import { stripe as stripeMachinePayments } from "mppx/server";
import Stripe from "stripe";
import { join } from "node:path";
import {
  PRIVY_API_BASE_URL,
  PRIVY_BASE_CHAIN_ID,
  STRIPE_API_VERSION,
  type RuntimeConfig
} from "./config.js";
import { createStripeIntegration } from "./stripe-integration.js";
import { createJsonResourceStore } from "./resource-store.js";
import {
  checkoutOfferClientConfig,
  defaultCheckoutOfferId,
  getCheckoutOffer,
  type CheckoutOffer
} from "./checkout-offers.js";
import { registerMcpRoutes } from "./mcp.js";
import {
  PostgresStripeAppEventStore,
  registerStripeAppUiRoutes,
  registerStripeAppWebhookRoute,
  type StripeAppEventStore
} from "./stripe-app.js";
import {
  PRIVATE_EMBEDDED_ONRAMP_PATH,
  componentsRawRequest,
  createEmbeddedOnrampSession,
  createLinkAuthIntent,
  exchangeLinkAccessToken,
  onrampPairs,
  validateOnrampRequest
} from "./onramp.js";
import { ONRAMP_WEBHOOK_EVENT_TYPE } from "./onramp-automation.js";
import { createPrivyPurchaseBridge } from "./privy-bridge.js";
import { PostgresPurchaseStore } from "./purchase-store.js";
import {
  asPurchasingError,
  CustomerPurchasingOrchestrator,
  type PurchasingOrchestratorOptions
} from "./purchasing-orchestrator.js";
import { registerPurchasingRoutes } from "./purchasing-routes.js";
import {
  AssessmentConflictError,
  AssessmentReceiptPendingError,
  PostgresReadinessAssessmentStore,
  type ReadinessAssessmentStore
} from "./readiness-assessment-store.js";
import { readinessRequestHash, validateReadinessAssessmentInput, type ReadinessAssessmentInput } from "./readiness-assessment.js";

const HANDLED_STRIPE_EVENTS = new Set([
  "payment_intent.created",
  "payment_intent.requires_action",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  // Embedded Onramp events are handled by CustomerPurchasingOrchestrator and
  // must never be claimed by the generic Stripe-App event store.
]);

function effectivePurchaseApprovalSigningKey(config: RuntimeConfig): string | undefined {
  if (config.purchaseApprovalSigningKey) return config.purchaseApprovalSigningKey;
  if (!config.mppSecretKey) return undefined;
  return crypto
    .createHmac("sha256", config.mppSecretKey)
    .update("set-purchase-approval-signing-v1")
    .digest("base64");
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type AppDependencies = {
  stripeAppEventStore?: StripeAppEventStore;
  purchasingOrchestrator?: CustomerPurchasingOrchestrator;
  purchasingOrchestratorFactory?: (config: RuntimeConfig, stripe: Stripe | undefined) => CustomerPurchasingOrchestrator | undefined;
  /** Alias retained for callers that name factories with a create prefix. */
  createPurchasingOrchestrator?: (config: RuntimeConfig, stripe: Stripe | undefined) => CustomerPurchasingOrchestrator | undefined;
  readinessAssessmentStore?: ReadinessAssessmentStore;
};

export function createDefaultPurchasingOrchestrator(
  config: RuntimeConfig,
  providedStripe?: Stripe
): CustomerPurchasingOrchestrator | undefined {
  const approvalSigningKey = effectivePurchaseApprovalSigningKey(config);
  const stripe = providedStripe ?? (config.stripeApiKey
    ? new Stripe(config.stripeApiKey, { apiVersion: STRIPE_API_VERSION })
    : undefined);
  if (
    !stripe ||
    !config.agenticEventsDatabaseUrl ||
    !config.privyAppId ||
    !config.privyAppSecret ||
    !approvalSigningKey
  ) return undefined;

  try {
    const options: PurchasingOrchestratorOptions = {
      store: new PostgresPurchaseStore(config.agenticEventsDatabaseUrl),
      privy: createPrivyPurchaseBridge({
        appId: config.privyAppId,
        appSecret: config.privyAppSecret,
        ...(config.privyJwtVerificationKey ? { verificationKey: config.privyJwtVerificationKey } : {})
      }),
      stripe,
      approvalSigningKey,
      onrampMode: (config.stripeMode ?? "test") === "live" ? "live" : "sandbox"
    };
    return new CustomerPurchasingOrchestrator(options);
  } catch (cause) {
    // A partial provider configuration should leave the service available for
    // non-purchasing routes while the purchasing surface fails closed.
    console.warn(JSON.stringify({
      kind: "purchasing_orchestrator_unavailable",
      reason: cause instanceof Error ? cause.message : "invalid_configuration"
    }));
    return undefined;
  }
}

export function createApp(config: RuntimeConfig, dependencies: AppDependencies = {}): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  const stripeMode = config.stripeMode ?? "test";
  const stripe = config.stripeApiKey ? new Stripe(config.stripeApiKey, { apiVersion: STRIPE_API_VERSION }) : undefined;
  const integration = stripe ? createStripeIntegration(stripe, config, createJsonResourceStore(".data/stripe-resources.json")) : undefined;
  const stripeEventStore = dependencies.stripeAppEventStore
    ?? (config.agenticEventsDatabaseUrl
      ? new PostgresStripeAppEventStore(config.agenticEventsDatabaseUrl)
      : undefined);
  const purchasingOrchestrator = dependencies.purchasingOrchestrator
    ?? dependencies.purchasingOrchestratorFactory?.(config, stripe)
    ?? dependencies.createPurchasingOrchestrator?.(config, stripe)
    ?? createDefaultPurchasingOrchestrator(config, stripe);
  const readinessAssessmentStore = dependencies.readinessAssessmentStore
    ?? (config.agenticEventsDatabaseUrl ? new PostgresReadinessAssessmentStore(config.agenticEventsDatabaseUrl) : undefined);
  const testIntegration = stripeMode === "test" ? integration : undefined;
  const machinePayments = stripe && config.stripeProfileId
    ? stripeMachinePayments.create({
        client: stripe,
        networkId: config.stripeProfileId,
        livemode: stripeMode === "live",
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
  const paidApi = mppx && readinessAssessmentStore ? mppx.charge({
    amount: "0.50",
    currency: "usd",
    decimals: 2,
    description: "SET Agentic Commerce Readiness Assessment",
    scope: "POST /paid"
  }) : undefined;
  mppx?.onPaymentSuccess(async ({ input, receipt }) => {
    if (!readinessAssessmentStore || !(input instanceof Request)) return;
    const idempotencyKey = input.headers.get("idempotency-key");
    if (!idempotencyKey) return;
    await readinessAssessmentStore.recordPayment(idempotencyKey, receipt);
  });

  app.disable("x-powered-by");
  const publicDirectory = join(process.cwd(), "public");

  app.use((_request, response, next) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://js.stripe.com https://crypto-js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com https://crypto-js.stripe.com https://*.stripe.com https://*.link.com; connect-src 'self' https://api.stripe.com https://crypto-js.stripe.com https://*.stripe.com https://*.link.com; img-src 'self' data: https://*.stripe.com https://*.link.com; style-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
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
      cryptoOnrampConfigured: Boolean(config.stripeApiKey && config.stripePublishableKey && config.stripeWebhookSecret && config.agenticEventsDatabaseUrl),
      cryptoEmbeddedComponentsConfigured: Boolean(config.stripeApiKey && config.stripePublishableKey && config.stripeLinkOauthClientId && config.stripeLinkOauthClientSecret),
      purchaseStoreConfigured: Boolean(config.agenticEventsDatabaseUrl),
      privyAuthenticationConfigured: Boolean(config.privyAppId && config.privyAppSecret),
      purchaseApprovalConfigured: Boolean(effectivePurchaseApprovalSigningKey(config)),
      purchasingConfigured: Boolean(purchasingOrchestrator),
      purchasingWebhookConfigured: Boolean(config.stripeWebhookSecret && purchasingOrchestrator),
      mppConfigured: Boolean(paidApi),
      mppPrice: { amount: "0.50", currency: "usd", unit: "readiness_assessment" },
      privyConfigured: Boolean(config.privyAppId && config.privyAppSecret),
      privy: {
        apiBaseUrl: PRIVY_API_BASE_URL,
        chain: "base",
        chainId: PRIVY_BASE_CHAIN_ID
      }
    });
  });

  app.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (request: Request, response: Response) => {
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

        const eventType = event.type as string;
        if (eventType === ONRAMP_WEBHOOK_EVENT_TYPE) {
          if (!purchasingOrchestrator) {
            response.status(503).json({ error: "The durable Stripe-Privy purchasing bridge is not fully configured.", code: "configuration_required" });
            return;
          }
          try {
            const result = await purchasingOrchestrator.processSignedWebhook(
              request.body as Buffer,
              signature,
              config.stripeWebhookSecret
            );
            response.status(200).json({
              received: true,
              handled: true,
              duplicate: result.duplicate,
              eventId: event.id,
              eventType: event.type,
              purchase: result.purchase
            });
          } catch (cause) {
            const issue = asPurchasingError(cause);
            response.status(issue.status).json({ error: issue.message, code: issue.code });
          }
          return;
        }
        const handled = HANDLED_STRIPE_EVENTS.has(eventType);
        const claimed = handled && stripeEventStore
          ? await stripeEventStore.claim({ eventId: event.id, eventType: event.type, accountId: event.account ?? null, livemode: event.livemode })
          : handled;
        const duplicate = handled && !claimed;
        if (claimed && eventType.startsWith("payment_intent.")) {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.info(JSON.stringify({
            kind: "stripe_payment_intent_event",
            eventId: event.id,
            eventType: event.type,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status
          }));
        }
        response.status(200).json({ received: true, handled, duplicate, eventId: event.id, eventType: event.type });
      } catch {
        response.status(400).json({ error: "Invalid Stripe webhook signature." });
      }
    }
  );

  registerStripeAppWebhookRoute(app, config, stripeEventStore);

  app.use(express.json({ limit: "100kb" }));
  registerPurchasingRoutes(app, purchasingOrchestrator);
  registerMcpRoutes(app, config);
  registerStripeAppUiRoutes(app, config);
  app.use("/assets", express.static(publicDirectory, { index: false, fallthrough: false }));

  app.get("/checkout", (_request, response) => {
    response.sendFile(join(publicDirectory, "checkout.html"));
  });

  app.get("/checkout/:offerId", (request, response, next) => {
    if (!getCheckoutOffer(request.params.offerId)) return next();
    return response.sendFile(join(publicDirectory, "checkout.html"));
  });

  const sendCheckoutConfig = (offer: CheckoutOffer | undefined, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!offer) return response.status(404).json({ error: "Checkout offer not found." });
    if (!config.stripePublishableKey) {
      return response.status(503).json({ error: "Stripe checkout is not configured." });
    }
    return response.json({
      publishableKey: config.stripePublishableKey,
      offer: checkoutOfferClientConfig(offer)
    });
  };

  app.get("/checkout/config", (_request, response) =>
    sendCheckoutConfig(getCheckoutOffer(defaultCheckoutOfferId), response));

  app.get("/checkout/:offerId/config", (request, response) =>
    sendCheckoutConfig(getCheckoutOffer(request.params.offerId), response));

  const confirmCheckoutIntent = async (offer: CheckoutOffer | undefined, request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!offer) return response.status(404).json({ error: "Checkout offer not found." });
    if (!integration || !config.stripePublishableKey) {
      return response.status(503).json({ error: "Stripe checkout credentials are not configured." });
    }
    const confirmationTokenId = request.body?.confirmationTokenId;
    if (typeof confirmationTokenId !== "string" || !/^ct_[A-Za-z0-9_]+$/.test(confirmationTokenId)) {
      return response.status(400).json({ error: "A valid ConfirmationToken ID is required." });
    }
    const customerEmail = normalizedEmail(request.body?.customerEmail);
    if (!customerEmail) {
      return response.status(400).json({ error: "A valid customer email address is required." });
    }
    const suppliedKey = request.header("idempotency-key");
    if (suppliedKey && !/^[A-Za-z0-9_-]{8,200}$/.test(suppliedKey)) {
      return response.status(400).json({ error: "Idempotency-Key must contain 8-200 URL-safe characters." });
    }
    const idempotencyKey = suppliedKey ?? `set-payment-intent-${crypto.randomUUID()}`;
    let effectiveOffer = offer;
    if (offer.openAmount) {
      const amount = request.body?.amount;
      const currency = request.body?.currency;
      if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000) {
        return response.status(400).json({ error: "Enter an amount between 1.00 and 10,000.00." });
      }
      if (currency !== "usd" && currency !== "eur") {
        return response.status(400).json({ error: "Choose USD or EUR." });
      }
      const paymentMethodTypes = currency === "usd"
        ? ["card", "cashapp", "crypto", "us_bank_account", "customer_balance"]
        : ["card", "bizum", "eps", "mb_way", "multibanco"];
      effectiveOffer = {
        ...offer,
        amount,
        currency,
        paymentMethodTypes: paymentMethodTypes as CheckoutOffer["paymentMethodTypes"],
        ...(currency === "usd" ? { customerBalanceBankTransferType: "us_bank_transfer" as const } : {})
      };
    }
    try {
      const paymentIntent = await integration.createAndConfirmPaymentIntent(
        effectiveOffer,
        confirmationTokenId,
        customerEmail,
        idempotencyKey
      );
      if (!paymentIntent.client_secret) {
        return response.status(502).json({ error: "Stripe did not return a PaymentIntent client secret." });
      }
      return response.status(201).json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status
      });
    } catch {
      return response.status(502).json({ error: "Stripe PaymentIntent confirmation failed." });
    }
  };

  app.post("/checkout/confirm-intent", (request, response) =>
    confirmCheckoutIntent(getCheckoutOffer(defaultCheckoutOfferId), request, response));

  app.post("/checkout/:offerId/confirm-intent", (request, response) =>
    confirmCheckoutIntent(getCheckoutOffer(request.params.offerId), request, response));

  app.get("/checkout/payment-intent/:paymentIntentId", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!integration) {
      return response.status(503).json({ error: "Stripe credentials are not configured." });
    }
    if (!/^pi_[A-Za-z0-9_]+$/.test(request.params.paymentIntentId)) {
      return response.status(400).json({ error: "Invalid PaymentIntent ID." });
    }
    try {
      const paymentIntent = await integration.retrievePaymentIntent(request.params.paymentIntentId);
      return response.json({
        id: paymentIntent.id,
        status: paymentIntent.status
      });
    } catch {
      return response.status(502).json({ error: "Stripe PaymentIntent lookup failed." });
    }
  });

  app.get("/checkout/return", (_request, response) => {
    response.sendFile(join(publicDirectory, "return.html"));
  });

  app.get("/crypto-fiat", (_request, response) => {
    response.sendFile(join(publicDirectory, "crypto-fiat-components.html"));
  });

  app.get("/crypto-fiat/components/config", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!config.stripePublishableKey || !config.stripeApiKey || !config.stripeLinkOauthClientId || !config.stripeLinkOauthClientSecret) {
      return response.status(503).json({ error: "Stripe Embedded Components is awaiting Link OAuth production configuration." });
    }
    return response.json({ publishableKey: config.stripePublishableKey, mode: stripeMode, country: "US", availability: "US excluding New York" });
  });

  app.post("/crypto-fiat/components/link-auth-intent", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!config.stripeApiKey || !config.stripeLinkOauthClientId || !config.stripeLinkOauthClientSecret) {
      return response.status(503).json({ error: "Link OAuth is not configured." });
    }
    const email = normalizedEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "A valid email address is required." });
    try {
      const result = await createLinkAuthIntent(config.stripeApiKey, config.stripeLinkOauthClientId, email);
      const authIntentId = result.data.id;
      if (typeof authIntentId === "string") return response.status(201).json({ authIntentId });
      return response.status(result.status).json({ error: result.status === 404 ? "No Link account exists for this email." : "Link authentication could not be started." });
    } catch {
      return response.status(502).json({ error: "Link authentication could not be started." });
    }
  });

  app.post("/crypto-fiat/components/session", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!stripe || !config.stripeApiKey || !config.stripeLinkOauthClientId || !config.stripeLinkOauthClientSecret) {
      return response.status(503).json({ error: "Stripe Embedded Components is not configured." });
    }
    const { authIntentId, cryptoCustomerId, paymentToken, sourceAmount, walletAddress } = request.body ?? {};
    if (typeof authIntentId !== "string" || !/^lai_[A-Za-z0-9_]+$/.test(authIntentId)) return response.status(400).json({ error: "A valid Link authorization is required." });
    if (typeof cryptoCustomerId !== "string" || !/^ccus_[A-Za-z0-9_]+$/.test(cryptoCustomerId)) return response.status(400).json({ error: "A valid crypto customer is required." });
    if (typeof paymentToken !== "string" || paymentToken.length > 512) return response.status(400).json({ error: "A valid crypto payment token is required." });
    if (typeof walletAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return response.status(400).json({ error: "Enter a valid Base wallet address." });
    const amount = Number(sourceAmount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 10_000) return response.status(400).json({ error: "Enter a USD amount from 1 to 10,000." });
    try {
      const oauthToken = await exchangeLinkAccessToken(config.stripeApiKey, authIntentId);
      const session = await componentsRawRequest<{ id: string; quote?: { expires_at?: number | null } }>(stripe, oauthToken, "POST", "/v1/crypto/onramp_sessions", {
        ui_mode: "headless",
        crypto_customer_id: cryptoCustomerId,
        payment_token: paymentToken,
        source_amount: String(amount),
        source_currency: "usd",
        destination_currency: "usdc",
        destination_currencies: ["usdc"],
        destination_network: "base",
        destination_networks: ["base"],
        wallet_address: walletAddress,
        ...(request.ip ? { customer_ip_address: request.ip } : {})
      });
      return response.status(201).json({ id: session.id, quoteExpiresAt: session.quote?.expires_at ?? null });
    } catch {
      return response.status(502).json({ error: "The Components session could not be created. Confirm private-preview gates and Link verification." });
    }
  });

  app.post("/crypto-fiat/components/session/:sessionId/quote", async (request, response) => {
    if (!stripe || !config.stripeApiKey) return response.status(503).json({ error: "Stripe Embedded Components is not configured." });
    const authIntentId = request.body?.authIntentId;
    if (typeof authIntentId !== "string" || !/^lai_[A-Za-z0-9_]+$/.test(authIntentId) || !/^cos_[A-Za-z0-9_]+$/.test(request.params.sessionId)) return response.status(400).json({ error: "Invalid session request." });
    try {
      const oauthToken = await exchangeLinkAccessToken(config.stripeApiKey, authIntentId);
      return response.json(await componentsRawRequest(stripe, oauthToken, "POST", `/v1/crypto/onramp_sessions/${request.params.sessionId}/quote`));
    } catch { return response.status(502).json({ error: "The quote could not be refreshed." }); }
  });

  app.post("/crypto-fiat/components/session/:sessionId/checkout", async (request, response) => {
    if (!stripe || !config.stripeApiKey) return response.status(503).json({ error: "Stripe Embedded Components is not configured." });
    const authIntentId = request.body?.authIntentId;
    if (typeof authIntentId !== "string" || !/^lai_[A-Za-z0-9_]+$/.test(authIntentId) || !/^cos_[A-Za-z0-9_]+$/.test(request.params.sessionId)) return response.status(400).json({ error: "Invalid checkout request." });
    try {
      const oauthToken = await exchangeLinkAccessToken(config.stripeApiKey, authIntentId);
      const session = await componentsRawRequest<{ client_secret?: string }>(stripe, oauthToken, "POST", `/v1/crypto/onramp_sessions/${request.params.sessionId}/checkout`, {
        mandate_data: { customer_acceptance: { type: "online", accepted_at: Math.floor(Date.now() / 1000), online: { ip_address: request.ip ?? "", user_agent: request.header("user-agent") ?? "" } } }
      });
      if (!session.client_secret) throw new Error("No checkout client secret.");
      return response.json({ client_secret: session.client_secret });
    } catch { return response.status(502).json({ error: "Stripe could not begin Components checkout." }); }
  });

  app.get(PRIVATE_EMBEDDED_ONRAMP_PATH, (_request, response) => response.sendFile(join(publicDirectory, "crypto-fiat.html")));
  app.get(`${PRIVATE_EMBEDDED_ONRAMP_PATH}/config`, (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!config.stripePublishableKey || !config.stripeApiKey || !config.stripeWebhookSecret || !config.agenticEventsDatabaseUrl) return response.status(503).json({ error: "Stripe Embedded Onramp is awaiting complete production configuration." });
    return response.json({ publishableKey: config.stripePublishableKey, mode: stripeMode, country: "US", pairs: onrampPairs() });
  });
  app.post(`${PRIVATE_EMBEDDED_ONRAMP_PATH}/session`, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!stripe || !config.stripePublishableKey || !config.stripeWebhookSecret || !config.agenticEventsDatabaseUrl) return response.status(503).json({ error: "Stripe Embedded Onramp is awaiting complete production configuration." });
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
      return response.status(400).json({ error: "A valid Idempotency-Key containing 8 to 128 safe characters is required." });
    }
    const input = validateOnrampRequest(request.body);
    if (!input.ok) return response.status(400).json({ error: input.error });
    try {
      const onrampSession = await createEmbeddedOnrampSession(stripe, { network: input.network, currency: input.currency, walletAddress: input.walletAddress, idempotencyKey, ...(request.ip ? { customerIp: request.ip } : {}) });
      if (!onrampSession.client_secret) throw new Error("Stripe returned no client secret.");
      return response.status(201).json({ clientSecret: onrampSession.client_secret, sessionId: onrampSession.id });
    } catch { return response.status(502).json({ error: "Stripe could not create an Embedded Onramp session. Confirm Onramp approval and the allowlisted domain in Dashboard." }); }
  });

  app.get("/", (_request, response) => {
    response.json({
      service: "SET USA Ops paid API",
      paidEndpoint: "POST /paid",
      discovery: "/openapi.json",
      price: { amount: "0.50", currency: "usd", unit: "readiness_assessment" }
    });
  });

  if (readinessAssessmentStore) {
    const recoveryStore = readinessAssessmentStore;
    app.post("/paid/recover", async (request, response) => {
      const idempotencyKey = request.header("idempotency-key");
      if (!idempotencyKey) return response.status(400).json({ error: "Idempotency-Key is required.", code: "invalid_request" });
      const validation = validateReadinessAssessmentInput(request.body);
      if (!validation.ok) return response.status(400).json({ error: validation.error, code: "invalid_request" });
      try {
        const artifact = await recoveryStore.fulfill(idempotencyKey, validation.input);
        response.setHeader("Cache-Control", "no-store");
        return response.json(artifact);
      } catch (cause) {
        if (cause instanceof AssessmentReceiptPendingError) {
          return response.status(409).json({ error: cause.message, code: "receipt_reconciliation_required" });
        }
        if (cause instanceof AssessmentConflictError) return response.status(404).json({ error: cause.message, code: "not_found" });
        return response.status(503).json({ error: "Readiness recovery is unavailable.", code: "configuration_required" });
      }
    });
  } else {
    app.post("/paid/recover", (_request, response) => {
      response.status(503).json({ error: "Readiness persistence is not configured.", code: "configuration_required" });
    });
  }

  if (mppx && paidApi) {
    const assessmentStore = readinessAssessmentStore!;
    const capabilitySchema = {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["implemented", "partial", "missing", "unknown"] },
        evidence: { type: "array", maxItems: 5, items: { type: "string", minLength: 1, maxLength: 240 } }
      }
    };
    discovery(app, mppx, {
      info: { title: "SET Agentic Commerce Readiness Assessment", version: "1.0.0" },
      routes: [{
        method: "POST",
        path: "/paid",
        handler: paidApi,
        summary: "Return one deterministic, payment-gated readiness assessment",
        requestBody: {
          type: "object",
          additionalProperties: false,
          required: ["workflow", "capabilities"],
          properties: {
            workflow: {
              type: "object",
              additionalProperties: false,
              required: ["name", "intendedUsers", "targetEnvironment"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                intendedUsers: { type: "string", enum: ["humans", "agents", "both"] },
                targetEnvironment: { type: "string", enum: ["sandbox", "production"] }
              }
            },
            capabilities: {
              type: "object",
              additionalProperties: false,
              required: [
                "machine_discovery", "payment_challenge_and_receipt", "idempotency", "webhook_verification",
                "durable_fulfillment", "user_authentication", "wallet_ownership", "onramp_provider_handoff",
                "delivery_evidence", "recovery_and_reconciliation"
              ],
              properties: Object.fromEntries([
                "machine_discovery", "payment_challenge_and_receipt", "idempotency", "webhook_verification",
                "durable_fulfillment", "user_authentication", "wallet_ownership", "onramp_provider_handoff",
                "delivery_evidence", "recovery_and_reconciliation"
              ].map((domain) => [domain, capabilitySchema]))
            }
          }
        }
      }]
    });

    app.post(
      "/paid",
      async (request, response, next) => {
        const idempotencyKey = request.header("idempotency-key");
        if (!idempotencyKey) return response.status(400).json({ error: "Idempotency-Key is required.", code: "invalid_request" });
        const validation = validateReadinessAssessmentInput(request.body);
        if (!validation.ok) return response.status(400).json({ error: validation.error, code: "invalid_request" });
        try {
          await assessmentStore.prepare(idempotencyKey, validation.input);
          response.locals.readinessInput = validation.input;
          response.locals.readinessIdempotencyKey = idempotencyKey;
          response.locals.readinessPaymentScope = `POST /paid:${idempotencyKey}:${readinessRequestHash(validation.input)}`;
          next();
        } catch (cause) {
          if (cause instanceof AssessmentConflictError) return response.status(409).json({ error: cause.message, code: "idempotency_conflict" });
          return response.status(503).json({ error: "Readiness persistence is unavailable; no payment challenge was issued.", code: "configuration_required" });
        }
      },
      (request, response, next) => mppx.charge({
        amount: "0.50",
        currency: "usd",
        decimals: 2,
        description: "SET Agentic Commerce Readiness Assessment",
        scope: response.locals.readinessPaymentScope as string
      })(request, response, next),
      async (_request, response) => {
        try {
          const artifact = await assessmentStore.fulfill(
            response.locals.readinessIdempotencyKey as string,
            response.locals.readinessInput as ReadinessAssessmentInput
          );
          response.setHeader("Cache-Control", "no-store");
          return response.json(artifact);
        } catch (cause) {
          if (cause instanceof AssessmentConflictError) return response.status(409).json({ error: cause.message, code: "idempotency_conflict" });
          if (cause instanceof AssessmentReceiptPendingError) {
            return response.status(503).json({ error: cause.message, code: "receipt_reconciliation_required" });
          }
          return response.status(503).json({ error: "Paid readiness fulfillment requires recovery against this same Idempotency-Key.", code: "fulfillment_recovery_required" });
        }
      }
    );
  } else {
    app.get("/openapi.json", (_request, response) => {
      response.status(503).json({ error: "MPP is not configured." });
    });
    app.post("/paid", (_request, response) => {
      response.status(503).json({ error: "MPP credentials are not configured." });
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
