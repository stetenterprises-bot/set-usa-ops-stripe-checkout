import Stripe from "stripe";
import { randomBytes } from "node:crypto";
import { type RuntimeConfig } from "./config.js";

type PersistedStripeResources = {
  connectedAccountId?: string;
  onboardingLinkUrl?: string;
  subscriptionProductId?: string;
  subscriptionPriceId?: string;
  setupIntentId?: string;
  subscriptionId?: string;
};

export type StripeResourceStore = {
  read(): Promise<PersistedStripeResources>;
  write(resources: PersistedStripeResources): Promise<void>;
};

const idempotencySuffix = () => randomBytes(8).toString("hex");
const integrationIdentifierSuffix = () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(8), (value) => alphabet[value % alphabet.length]).join("");
};

function requireConfiguredKey(config: RuntimeConfig): void {
  if (!config.stripeApiKey) throw new Error("STRIPE_API_KEY is required for this operation.");
  const expectedMode = config.stripeMode ?? "test";
  if (!config.stripeApiKey.includes(`_${expectedMode}_`)) {
    throw new Error(`Stripe API key does not match STRIPE_MODE=${expectedMode}.`);
  }
}

function requireTestMode(config: RuntimeConfig): void {
  requireConfiguredKey(config);
  if ((config.stripeMode ?? "test") !== "test") {
    throw new Error("This experimental operation is disabled in live mode.");
  }
}

export function createStripeIntegration(
  stripe: Stripe,
  config: RuntimeConfig,
  store: StripeResourceStore
) {
  return {
    async createAndConfirmPaymentIntent(confirmationTokenId: string, idempotencyKey: string) {
      requireConfiguredKey(config);
      return stripe.paymentIntents.create(
        {
          amount: 49_500,
          currency: "usd",
          allowed_payment_method_types: ["card"],
          confirm: true,
          confirmation_token: confirmationTokenId,
          metadata: {
            seller: "SET Business Consults",
            offer: "workflow_improvement_review",
            integration: `set_server_confirmed_${integrationIdentifierSuffix()}`
          }
        },
        { idempotencyKey }
      );
    },

    async retrievePaymentIntent(paymentIntentId: string) {
      requireConfiguredKey(config);
      return stripe.paymentIntents.retrieve(paymentIntentId);
    },

    async createConnectedAccount(country: string) {
      requireTestMode(config);
      const account = await stripe.v2.core.accounts.create(
        {
          display_name: "Test account",
          contact_email: "testaccount@example.com",
          configuration: {
            merchant: { simulate_accept_tos_obo: true } as unknown as Stripe.V2.Core.AccountCreateParams.Configuration.Merchant,
            customer: {}
          },
          include: [
            "configuration.merchant",
            "configuration.recipient",
            "identity",
            "defaults",
            "configuration.customer"
          ],
          identity: { country, business_details: { phone: "0000000000" } },
          dashboard: "full",
          defaults: { responsibilities: { losses_collector: "stripe", fees_collector: "stripe" } }
        },
        { idempotencyKey: `set-create-account-${country}-${idempotencySuffix()}` }
      );
      await store.write({ ...(await store.read()), connectedAccountId: account.id });
      return account;
    },

    async createOnboardingLink(accountId: string) {
      requireTestMode(config);
      const link = await stripe.v2.core.accountLinks.create(
        {
          account: accountId,
          use_case: {
            type: "account_onboarding",
            account_onboarding: {
              configurations: ["merchant", "customer"],
              refresh_url: `${config.applicationBaseUrl}/stripe/onboarding/refresh?account_id=${encodeURIComponent(accountId)}`,
              return_url: `${config.applicationBaseUrl}/stripe/onboarding/return?account_id=${encodeURIComponent(accountId)}`
            }
          }
        },
        { idempotencyKey: `set-account-link-${accountId}-${idempotencySuffix()}` }
      );
      // Account Links are single-use URLs, so return them to the caller but do not persist them.
      return link;
    },

    async createCheckoutSession(accountId: string, currency: string) {
      requireTestMode(config);
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          integration_identifier: `set-embedded-${idempotencySuffix()}`,
          success_url: `${config.applicationBaseUrl}/stripe/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          line_items: [{ price_data: { currency, product_data: { name: "Cookie" }, unit_amount: 100000 }, quantity: 1 }],
          payment_intent_data: { application_fee_amount: 123 }
        },
        { stripeAccount: accountId, idempotencyKey: `set-checkout-${accountId}-${idempotencySuffix()}` }
      );
      return session;
    },

    async createSubscriptionPlan(currency: string) {
      requireTestMode(config);
      const product = await stripe.products.create(
        { name: "Platform subscription", default_price_data: { currency, recurring: { interval: "month" }, unit_amount: 1000 } },
        { idempotencyKey: `set-subscription-product-${currency}-${idempotencySuffix()}` }
      );
      const priceId = typeof product.default_price === "string" ? product.default_price : product.default_price?.id;
      if (!priceId) throw new Error("Stripe did not return the subscription price ID.");
      await store.write({ ...(await store.read()), subscriptionProductId: product.id, subscriptionPriceId: priceId });
      return { product, priceId };
    },

    async createBalanceSetupIntent(accountId: string) {
      requireTestMode(config);
      const setupIntent = await stripe.setupIntents.create(
        {
          payment_method_types: ["stripe_balance"],
          confirm: true,
          customer_account: accountId,
          usage: "off_session",
          payment_method_data: { type: "stripe_balance" }
        },
        { idempotencyKey: `set-setup-intent-${accountId}-${idempotencySuffix()}` }
      );
      await store.write({ ...(await store.read()), setupIntentId: setupIntent.id });
      return setupIntent;
    },

    async createAccountSubscription(accountId: string, priceId: string, paymentMethodId: string) {
      requireTestMode(config);
      const subscription = await stripe.subscriptions.create(
        {
          customer_account: accountId,
          default_payment_method: paymentMethodId,
          items: [{ price: priceId, quantity: 1 }],
          payment_settings: { payment_method_types: ["stripe_balance"] }
        },
        { idempotencyKey: `set-subscription-${accountId}-${priceId}-${idempotencySuffix()}` }
      );
      await store.write({ ...(await store.read()), subscriptionId: subscription.id });
      return subscription;
    }
  };
}
