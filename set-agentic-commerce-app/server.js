import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const MAX_BODY_BYTES = 1_048_576;
const HANDLED_EVENTS = new Set([
  "account.application.authorized",
  "account.application.deauthorized",
  "payment_intent.created",
  "payment_intent.requires_action",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled"
]);

function sendJson(response, status, body, cors = false) {
  if (cors) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createStripeAppServer(configuration = {}) {
  const config = {
    appSigningSecret: configuration.appSigningSecret ?? process.env.STRIPE_APP_SIGNING_SECRET,
    appWebhookSecret: configuration.appWebhookSecret ?? process.env.STRIPE_APP_WEBHOOK_SECRET,
    stripeApiKey: configuration.stripeApiKey ?? process.env.STRIPE_API_KEY,
    stripeProfileId: configuration.stripeProfileId ?? process.env.STRIPE_PROFILE_ID,
    stripePublishableKey: configuration.stripePublishableKey ?? process.env.STRIPE_PUBLISHABLE_KEY,
    stripeWebhookSecret: configuration.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET,
    privyAppId: configuration.privyAppId ?? process.env.PRIVY_APP_ID,
    privyAppSecret: configuration.privyAppSecret ?? process.env.PRIVY_APP_SECRET
  };
  const processedEventIds = new Set();

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/stripe-app/readiness" && request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === "/stripe-app/readiness" && request.method === "POST") {
      if (!config.appSigningSecret) {
        sendJson(response, 503, { error: "Stripe App signed-request verification is not configured." }, true);
        return;
      }
      try {
        const body = JSON.parse((await readBody(request)).toString("utf8"));
        const payload = JSON.stringify({ user_id: body.user_id, account_id: body.account_id });
        Stripe.webhooks.signature.verifyHeader(
          payload,
          request.headers["stripe-signature"],
          config.appSigningSecret
        );
        sendJson(response, 200, {
          ok: true,
          mppConfigured: Boolean(config.stripeApiKey && config.stripeProfileId),
          privyConfigured: Boolean(config.privyAppId && config.privyAppSecret),
          checkoutConfigured: Boolean(config.stripeApiKey && config.stripePublishableKey),
          paymentWebhookConfigured: Boolean(config.stripeWebhookSecret),
          appEventsConfigured: Boolean(config.appWebhookSecret),
          executionAuthorized: false
        }, true);
      } catch {
        sendJson(response, 401, { error: "Invalid Stripe App signature." }, true);
      }
      return;
    }

    if (url.pathname === "/stripe-app/events" && request.method === "POST") {
      if (!config.appWebhookSecret) {
        sendJson(response, 503, { error: "Stripe App event verification is not configured." });
        return;
      }
      try {
        const rawBody = await readBody(request);
        const event = Stripe.webhooks.constructEvent(
          rawBody,
          request.headers["stripe-signature"],
          config.appWebhookSecret
        );
        const duplicate = processedEventIds.has(event.id);
        processedEventIds.add(event.id);
        if (processedEventIds.size > 1_000) {
          const oldest = processedEventIds.values().next().value;
          if (oldest) processedEventIds.delete(oldest);
        }
        const handled = HANDLED_EVENTS.has(event.type);
        if (handled && !duplicate) {
          console.info(JSON.stringify({
            kind: "stripe_app_event",
            eventId: event.id,
            eventType: event.type,
            accountId: event.account ?? null,
            livemode: event.livemode
          }));
        }
        sendJson(response, 200, { received: true, handled, duplicate, eventId: event.id });
      } catch {
        sendJson(response, 400, { error: "Invalid Stripe App webhook signature." });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "4243");
  createStripeAppServer().listen(port, "127.0.0.1", () => {
    console.info(`SET Stripe App backend listening on http://127.0.0.1:${port}`);
  });
}
