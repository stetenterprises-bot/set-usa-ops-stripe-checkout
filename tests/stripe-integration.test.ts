import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createStripeIntegration } from "../src/stripe-integration.js";

describe("server-confirmed Payment Element", () => {
  it("creates and confirms a server-authoritative PaymentIntent from a ConfirmationToken", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "pi_test_example",
      client_secret: "pi_test_example_secret_example",
      status: "succeeded"
    });
    const stripe = {
      paymentIntents: { create, retrieve: vi.fn() }
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

    await integration.createAndConfirmPaymentIntent("ct_test_example", "checkout_retry_12345678");

    expect(create).toHaveBeenCalledOnce();
    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({
      amount: 49_500,
      currency: "usd",
      confirm: true,
      confirmation_token: "ct_test_example",
      metadata: { seller: "SET Business Consults", offer: "workflow_improvement_review" }
    });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params).not.toHaveProperty("automatic_payment_methods");
    expect(options).toEqual({ idempotencyKey: "checkout_retry_12345678" });
  });
});
