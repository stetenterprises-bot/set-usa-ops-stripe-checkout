import type { Express, Request, Response } from "express";
import express from "express";
import { Pool } from "pg";
import Stripe from "stripe";
import type { RuntimeConfig } from "./config.js";

const APP_EVENT_TYPES = new Set([
  "account.application.authorized",
  "account.application.deauthorized",
  "payment_intent.created",
  "payment_intent.requires_action",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled"
]);

export type StripeAppEventClaim = {
  eventId: string;
  eventType: string;
  accountId: string | null;
  livemode: boolean;
};

export interface StripeAppEventStore {
  claim(event: StripeAppEventClaim): Promise<boolean>;
}

export class InMemoryStripeAppEventStore implements StripeAppEventStore {
  private readonly processedEventIds = new Set<string>();

  async claim(event: StripeAppEventClaim): Promise<boolean> {
    if (this.processedEventIds.has(event.eventId)) return false;
    this.processedEventIds.add(event.eventId);
    if (this.processedEventIds.size > 1_000) {
      const oldest = this.processedEventIds.values().next().value;
      if (oldest) this.processedEventIds.delete(oldest);
    }
    return true;
  }
}

type EventDatabase = Pick<Pool, "query">;

export class PostgresStripeAppEventStore implements StripeAppEventStore {
  private readonly database: EventDatabase;
  private initializePromise?: Promise<void>;

  constructor(connectionStringOrDatabase: string | EventDatabase) {
    this.database = typeof connectionStringOrDatabase === "string"
      ? new Pool({ connectionString: connectionStringOrDatabase, max: 5 })
      : connectionStringOrDatabase;
  }

  private initialize(): Promise<void> {
    this.initializePromise ??= this.database.query(`
      CREATE TABLE IF NOT EXISTS stripe_app_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        account_id TEXT,
        livemode BOOLEAN NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined);
    return this.initializePromise;
  }

  async claim(event: StripeAppEventClaim): Promise<boolean> {
    await this.initialize();
    const result = await this.database.query(
      `INSERT INTO stripe_app_events (event_id, event_type, account_id, livemode)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.eventType, event.accountId, event.livemode]
    );
    return result.rowCount === 1;
  }
}

function setUiCors(response: Response): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function signedUiPayload(request: Request): string | null {
  const userId = request.body?.user_id;
  const accountId = request.body?.account_id;
  if (typeof userId !== "string" || typeof accountId !== "string") return null;
  if (userId.length > 255 || accountId.length > 255) return null;
  return JSON.stringify({ user_id: userId, account_id: accountId });
}

export function registerStripeAppWebhookRoute(
  app: Express,
  config: RuntimeConfig,
  eventStore: StripeAppEventStore = new InMemoryStripeAppEventStore()
): void {
  app.post(
    "/stripe-app/events",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (request: Request, response: Response) => {
      if (!config.stripeAppWebhookSecret) {
        response.status(503).json({ error: "Stripe App event verification is not configured." });
        return;
      }
      const signature = request.header("stripe-signature");
      if (!signature) {
        response.status(400).json({ error: "Missing Stripe-Signature header." });
        return;
      }
      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(
          request.body as Buffer,
          signature,
          config.stripeAppWebhookSecret
        );
      } catch {
        response.status(400).json({ error: "Invalid Stripe App webhook signature." });
        return;
      }

      const claim = {
        eventId: event.id,
        eventType: event.type,
        accountId: event.account ?? null,
        livemode: event.livemode
      };
      let claimed: boolean;
      try {
        claimed = await eventStore.claim(claim);
      } catch {
        console.error(JSON.stringify({
          kind: "stripe_app_event_store_error",
          eventId: event.id,
          eventType: event.type
        }));
        response.status(503).json({ error: "Stripe App event storage is temporarily unavailable." });
        return;
      }

      const duplicate = !claimed;
      const handled = APP_EVENT_TYPES.has(event.type);
      if (handled && claimed) {
        console.info(JSON.stringify({ kind: "stripe_app_event", ...claim }));
      }
      response.status(200).json({ received: true, handled, duplicate, eventId: event.id });
    }
  );
}

export function registerStripeAppUiRoutes(app: Express, config: RuntimeConfig): void {
  app.options("/stripe-app/readiness", (_request, response) => {
    setUiCors(response);
    response.status(204).end();
  });

  app.post("/stripe-app/readiness", (request, response) => {
    setUiCors(response);
    response.setHeader("Cache-Control", "no-store");
    const signingSecrets = [
      config.stripeAppSigningSecret,
      config.stripeAppSandboxSigningSecret
    ].filter((secret): secret is string => Boolean(secret));
    if (signingSecrets.length === 0) {
      response.status(503).json({ error: "Stripe App signed-request verification is not configured." });
      return;
    }
    const signature = request.header("stripe-signature");
    const payload = signedUiPayload(request);
    if (!signature || !payload) {
      console.warn(JSON.stringify({
        kind: "stripe_app_readiness_rejected",
        reason: !signature ? "missing_signature" : "invalid_context"
      }));
      response.status(400).json({ error: "Signed Stripe user and account context is required." });
      return;
    }
    try {
      const signatureVerifier = Stripe.webhooks.signature;
      if (!signatureVerifier) throw new Error("Stripe signature verifier is unavailable.");
      const verified = signingSecrets.some((secret) => {
        try {
          signatureVerifier.verifyHeader(payload, signature, secret);
          return true;
        } catch {
          return false;
        }
      });
      if (!verified) throw new Error("Invalid Stripe App signature.");
      console.info(JSON.stringify({ kind: "stripe_app_readiness_verified" }));
      response.json({
        ok: true,
        mppConfigured: Boolean(config.stripeApiKey && config.stripeProfileId),
        privyConfigured: Boolean(config.privyAppId && config.privyAppSecret),
        checkoutConfigured: Boolean(config.stripeApiKey && config.stripePublishableKey),
        paymentWebhookConfigured: Boolean(config.stripeWebhookSecret),
        appEventsConfigured: Boolean(config.stripeAppWebhookSecret),
        durableEventStoreConfigured: Boolean(config.agenticEventsDatabaseUrl),
        executionAuthorized: false
      });
    } catch {
      console.warn(JSON.stringify({
        kind: "stripe_app_readiness_rejected",
        reason: "invalid_signature",
        productionSecretConfigured: Boolean(config.stripeAppSigningSecret),
        sandboxSecretConfigured: Boolean(config.stripeAppSandboxSigningSecret)
      }));
      response.status(401).json({ error: "Invalid Stripe App signature." });
    }
  });
}
