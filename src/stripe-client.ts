import Stripe from "stripe";
import { STRIPE_API_VERSION, type RuntimeConfig } from "./config.js";

export function createStripeClient(config: RuntimeConfig): Stripe {
  if (!config.stripeApiKey) {
    throw new Error("STRIPE_API_KEY is required for authenticated Stripe operations.");
  }

  return new Stripe(config.stripeApiKey, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "SET USA Ops Stripe Development",
      version: "0.1.0"
    },
    maxNetworkRetries: 2,
    timeout: 20_000
  });
}

