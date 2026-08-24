import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createStripeIntegration } from "../src/stripe-integration.js";

describe("direct embedded Checkout", () => {
  it("creates a server-authoritative Elements session without Connect or fixed payment methods", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_example",
      client_secret: "cs_test_example_secret_example"
    });
    const stripe = {
      checkout: { sessions: { create, retrieve: vi.fn() } }
    } as unknown as Stripe;
    const store = {
      read: vi.fn().mockResolvedValue({}),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const integration = createStripeIntegration(
      stripe,
      {
        port: 4242,
        applicationBaseUrl: "http://127.0.0.1:4242",
        stripeApiKey: ["rk", "test", "unitvalue"].join("_"),
        stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
      },
      store
    );

    await integration.createEmbeddedCheckoutSession("checkout_retry_12345678");

    expect(create).toHaveBeenCalledOnce();
    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({
      ui_mode: "elements",
      mode: "payment",
      automatic_tax: { enabled: false },
      line_items: [{ price_data: { currency: "usd", unit_amount: 49_500 }, quantity: 1 }]
    });
    expect(params.integration_identifier).toMatch(/^set-workflow-review-[a-z]{8}$/);
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params).not.toHaveProperty("payment_intent_data");
    expect(options).toEqual({ idempotencyKey: "checkout_retry_12345678" });
  });
});
