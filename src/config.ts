import { config as loadDotenv } from "dotenv";

loadDotenv({
  path: process.env.DOTENV_CONFIG_PATH ?? ".env.app",
  quiet: true
});

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;
export const PRIVY_API_BASE_URL = "https://api.privy.io" as const;
export const PRIVY_BASE_CHAIN_ID = 8453 as const;

export type RuntimeConfig = {
  port: number;
  stripeMode?: "test" | "live";
  stripeApiKey?: string;
  stripePublishableKey?: string;
  stripeWebhookSecret?: string;
  stripeAppSigningSecret?: string;
  stripeAppSandboxSigningSecret?: string;
  stripeAppWebhookSecret?: string;
  stripeLinkOauthClientId?: string;
  stripeLinkOauthClientSecret?: string;
  agenticEventsDatabaseUrl?: string;
  stripeProfileId?: string;
  mppSecretKey?: string;
  privyAppId?: string;
  privyAppSecret?: string;
  privyJwtVerificationKey?: string;
  purchaseApprovalSigningKey?: string;
  applicationBaseUrl: string;
};

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const stripeMode = optionalSecret(env.STRIPE_MODE) ?? "test";
  const stripeApiKey = optionalSecret(env.STRIPE_API_KEY);
  const stripePublishableKey = optionalSecret(env.STRIPE_PUBLISHABLE_KEY);
  const stripeWebhookSecret = optionalSecret(env.STRIPE_WEBHOOK_SECRET);
  const stripeAppSigningSecret = optionalSecret(env.STRIPE_APP_SIGNING_SECRET);
  const stripeAppSandboxSigningSecret = optionalSecret(env.STRIPE_APP_SANDBOX_SIGNING_SECRET);
  const stripeAppWebhookSecret = optionalSecret(env.STRIPE_APP_WEBHOOK_SECRET);
  const stripeLinkOauthClientId = optionalSecret(env.STRIPE_LINK_OAUTH_CLIENT_ID);
  const stripeLinkOauthClientSecret = optionalSecret(env.STRIPE_LINK_OAUTH_CLIENT_SECRET);
  const agenticEventsDatabaseUrl = optionalSecret(env.AGENTIC_EVENTS_DB_URL);
  const stripeProfileId = optionalSecret(env.STRIPE_PROFILE_ID);
  const mppSecretKey = optionalSecret(env.MPP_SECRET_KEY);
  const managedPrivyAppId = optionalSecret(env.PRIVY_PRIVY_APP_ID);
  const managedPrivyAppSecret = optionalSecret(env.PRIVY_PRIVY_APP_SECRET);
  if (Boolean(managedPrivyAppId) !== Boolean(managedPrivyAppSecret)) {
    throw new Error("PRIVY_PRIVY_APP_ID and PRIVY_PRIVY_APP_SECRET must be configured together.");
  }
  // Stripe Projects prefixes Privy's exported names with the provider name.
  // Prefer that managed pair while retaining the conventional names for other
  // deployment environments.
  const privyAppId = managedPrivyAppId ?? optionalSecret(env.PRIVY_APP_ID);
  const privyAppSecret = managedPrivyAppSecret ?? optionalSecret(env.PRIVY_APP_SECRET);
  const privyJwtVerificationKey = optionalSecret(env.PRIVY_JWT_VERIFICATION_KEY);
  const purchaseApprovalSigningKey = optionalSecret(env.PURCHASE_APPROVAL_SIGNING_KEY);
  const applicationBaseUrl = optionalSecret(env.APPLICATION_BASE_URL) ?? "http://localhost:4242";
  const port = Number(optionalSecret(env.PORT) ?? "4242");

  if (stripeMode !== "test" && stripeMode !== "live") {
    throw new Error("STRIPE_MODE must be either test or live.");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535.");
  }

  const expectedApiKeyPrefixes = stripeMode === "live" ? ["rk_live_", "sk_live_"] : ["rk_test_", "sk_test_"];
  if (stripeApiKey && !expectedApiKeyPrefixes.some((prefix) => stripeApiKey.startsWith(prefix))) {
    throw new Error(`STRIPE_API_KEY must match STRIPE_MODE=${stripeMode}.`);
  }

  const expectedPublishablePrefix = stripeMode === "live" ? "pk_live_" : "pk_test_";
  if (stripePublishableKey && !stripePublishableKey.startsWith(expectedPublishablePrefix)) {
    throw new Error(`STRIPE_PUBLISHABLE_KEY must match STRIPE_MODE=${stripeMode}.`);
  }

  const isSandboxProfile = stripeProfileId?.startsWith("profile_test_") ?? false;
  const isLiveProfile = stripeProfileId?.startsWith("profile_") === true && !isSandboxProfile;
  if (stripeProfileId && (stripeMode === "live" ? !isLiveProfile : !isSandboxProfile)) {
    throw new Error(`STRIPE_PROFILE_ID must match STRIPE_MODE=${stripeMode}.`);
  }

  if (mppSecretKey && Buffer.byteLength(mppSecretKey, "utf8") < 32) {
    throw new Error("MPP_SECRET_KEY must contain at least 32 bytes.");
  }

  if (stripeProfileId && !stripeApiKey) {
    throw new Error("STRIPE_API_KEY is required when STRIPE_PROFILE_ID is configured for MPP.");
  }

  if (Boolean(privyAppId) !== Boolean(privyAppSecret)) {
    throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be configured together.");
  }

  if (privyAppId && !/^[A-Za-z0-9_-]{10,128}$/.test(privyAppId)) {
    throw new Error("The configured Privy app ID is invalid.");
  }

  if (purchaseApprovalSigningKey && Buffer.byteLength(purchaseApprovalSigningKey, "utf8") < 32) {
    throw new Error("PURCHASE_APPROVAL_SIGNING_KEY must contain at least 32 bytes.");
  }

  if (Boolean(stripeLinkOauthClientId) !== Boolean(stripeLinkOauthClientSecret)) {
    throw new Error("STRIPE_LINK_OAUTH_CLIENT_ID and STRIPE_LINK_OAUTH_CLIENT_SECRET must be configured together.");
  }

  if (stripeLinkOauthClientId && !stripeLinkOauthClientId.startsWith("lwlpk_")) {
    throw new Error("STRIPE_LINK_OAUTH_CLIENT_ID must be a Link OAuth client ID.");
  }

  if (stripeLinkOauthClientSecret && !stripeLinkOauthClientSecret.startsWith("lwlsk_")) {
    throw new Error("STRIPE_LINK_OAUTH_CLIENT_SECRET must be a Link OAuth client secret.");
  }

  if (agenticEventsDatabaseUrl) {
    const databaseUrl = new URL(agenticEventsDatabaseUrl);
    if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
      throw new Error("AGENTIC_EVENTS_DB_URL must be a PostgreSQL connection URL.");
    }
  }

  if (stripeMode === "live" && stripeAppWebhookSecret && !agenticEventsDatabaseUrl) {
    throw new Error("Live Stripe App events require AGENTIC_EVENTS_DB_URL for durable deduplication.");
  }

  const parsedBaseUrl = new URL(applicationBaseUrl);
  if (stripeMode === "live") {
    if (env.NODE_ENV !== "production") {
      throw new Error("STRIPE_MODE=live requires NODE_ENV=production.");
    }
    if (parsedBaseUrl.protocol !== "https:") {
      throw new Error("STRIPE_MODE=live requires an HTTPS APPLICATION_BASE_URL.");
    }
    if (!stripeApiKey || !stripePublishableKey || !stripeWebhookSecret) {
      throw new Error("Live Checkout requires STRIPE_API_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET.");
    }
  }

  return {
    port,
    stripeMode,
    applicationBaseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    ...(stripeApiKey ? { stripeApiKey } : {}),
    ...(stripePublishableKey ? { stripePublishableKey } : {}),
    ...(stripeWebhookSecret ? { stripeWebhookSecret } : {}),
    ...(stripeAppSigningSecret ? { stripeAppSigningSecret } : {}),
    ...(stripeAppSandboxSigningSecret ? { stripeAppSandboxSigningSecret } : {}),
    ...(stripeAppWebhookSecret ? { stripeAppWebhookSecret } : {}),
    ...(stripeLinkOauthClientId ? { stripeLinkOauthClientId } : {}),
    ...(stripeLinkOauthClientSecret ? { stripeLinkOauthClientSecret } : {}),
    ...(agenticEventsDatabaseUrl ? { agenticEventsDatabaseUrl } : {}),
    ...(stripeProfileId ? { stripeProfileId } : {}),
    ...(mppSecretKey ? { mppSecretKey } : {}),
    ...(privyAppId ? { privyAppId } : {}),
    ...(privyAppSecret ? { privyAppSecret } : {}),
    ...(privyJwtVerificationKey ? { privyJwtVerificationKey } : {}),
    ...(purchaseApprovalSigningKey ? { purchaseApprovalSigningKey } : {})
  };
}
