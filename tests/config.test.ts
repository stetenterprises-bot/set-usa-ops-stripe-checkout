import { describe, expect, it } from "vitest";
import { loadConfig, PRIVY_APP_ID, STRIPE_API_VERSION } from "../src/config.js";

const key = (mode: "test" | "live", kind: "rk" | "sk") =>
  [kind, mode, "examplevalue"].join("_");

describe("local Stripe configuration", () => {
  it("runs without credentials for local-only checks", () => {
    expect(loadConfig({})).toEqual({
      port: 4242,
      stripeMode: "test",
      applicationBaseUrl: "http://localhost:4242"
    });
  });

  it("uses the default port when PORT is blank", () => {
    expect(loadConfig({ PORT: "   " }).port).toBe(4242);
  });

  it("pins the target Stripe API version", () => {
    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
  });

  it("accepts test restricted keys", () => {
    expect(loadConfig({
      STRIPE_API_KEY: key("test", "rk"),
      STRIPE_PROFILE_ID: "profile_test_examplevalue"
    }).stripeApiKey).toBe(
      key("test", "rk")
    );
  });

  it("accepts a test publishable key and blocks a live publishable key", () => {
    expect(loadConfig({ STRIPE_PUBLISHABLE_KEY: "pk_test_examplevalue" }).stripePublishableKey)
      .toBe("pk_test_examplevalue");
    expect(() => loadConfig({ STRIPE_PUBLISHABLE_KEY: "pk_live_examplevalue" }))
      .toThrow(/STRIPE_MODE=test/);
  });

  it("blocks live keys", () => {
    expect(() => loadConfig({ STRIPE_API_KEY: key("live", "sk") })).toThrow(/STRIPE_MODE=test/);
  });

  it("accepts a complete HTTPS live Checkout configuration", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STRIPE_API_KEY: key("live", "rk"),
      STRIPE_PUBLISHABLE_KEY: ["pk", "live", "examplevalue"].join("_"),
      STRIPE_WEBHOOK_SECRET: ["whsec", "examplevalue"].join("_"),
      APPLICATION_BASE_URL: "https://checkout.example.com"
    });

    expect(config.stripeMode).toBe("live");
    expect(config.applicationBaseUrl).toBe("https://checkout.example.com");
  });

  it("fails closed when live Checkout is incomplete or not HTTPS", () => {
    expect(() => loadConfig({ STRIPE_MODE: "live" })).toThrow(/NODE_ENV=production/);
    expect(() => loadConfig({
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STRIPE_API_KEY: key("live", "rk"),
      STRIPE_PUBLISHABLE_KEY: ["pk", "live", "examplevalue"].join("_"),
      STRIPE_WEBHOOK_SECRET: ["whsec", "examplevalue"].join("_"),
      APPLICATION_BASE_URL: "http://checkout.example.com"
    })).toThrow(/HTTPS/);
  });

  it("allows Checkout credentials without an MPP profile and requires a key for a profile", () => {
    expect(loadConfig({ STRIPE_API_KEY: key("test", "sk") }).stripeApiKey).toBe(key("test", "sk"));
    expect(() => loadConfig({ STRIPE_PROFILE_ID: "profile_test_examplevalue" })).toThrow(/required/);
  });

  it("blocks live profile IDs", () => {
    expect(() => loadConfig({
      STRIPE_API_KEY: key("test", "sk"),
      STRIPE_PROFILE_ID: "profile_live_examplevalue"
    })).toThrow(/sandbox profile/);
  });

  it("requires a strong explicit MPP signing secret", () => {
    expect(() => loadConfig({ MPP_SECRET_KEY: "too-short" })).toThrow(/at least 32 bytes/);
  });

  it("accepts only the approved Privy app with its backend secret", () => {
    const config = loadConfig({
      PRIVY_APP_ID,
      PRIVY_APP_SECRET: "privy-test-secret"
    });
    expect(config.privyAppId).toBe(PRIVY_APP_ID);
    expect(config.privyAppSecret).toBe("privy-test-secret");
    expect(() => loadConfig({ PRIVY_APP_ID })).toThrow(/configured together/);
    expect(() => loadConfig({
      PRIVY_APP_ID: "different-app",
      PRIVY_APP_SECRET: "privy-test-secret"
    })).toThrow(/approved app/);
  });
});
