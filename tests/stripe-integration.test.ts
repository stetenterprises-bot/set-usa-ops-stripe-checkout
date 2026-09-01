import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createStripeIntegration } from "../src/stripe-integration.js";
import { getCheckoutOffer } from "../src/checkout-offers.js";

describe("server-confirmed Payment Element", () => {
  it("exposes the open payment offer without a preset customer-facing amount", () => {
    const offer = getCheckoutOffer("open-payment")!;

    expect(offer.openAmount).toBe(true);
    expect(offer.title).toBe("Open Payment");
    expect(offer.amount).toBe(100);
    expect(offer.currency).toBe("usd");
  });

  it("creates and confirms a server-authoritative PaymentIntent from a ConfirmationToken", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "pi_test_example",
      client_secret: "pi_test_example_secret_example",
      status: "succeeded"
    });
    const createCustomer = vi.fn().mockResolvedValue({ id: "cus_test_example" });
    const stripe = {
      customers: { create: createCustomer },
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

    const offer = getCheckoutOffer("workflow-improvement-review-495-usd")!;
    await integration.createAndConfirmPaymentIntent(offer, "ct_test_example", "buyer@example.com", "checkout_retry_12345678");

    expect(createCustomer).toHaveBeenCalledWith(
      {
        email: "buyer@example.com",
        metadata: { checkout_offer: "workflow-improvement-review-495-usd" }
      },
      { idempotencyKey: "checkout_retry_12345678-customer" }
    );
    expect(create).toHaveBeenCalledOnce();
    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({
      amount: 49_500,
      currency: "usd",
      allowed_payment_method_types: ["card", "cashapp", "crypto", "us_bank_account", "customer_balance"],
      confirm: true,
      confirmation_token: "ct_test_example",
      receipt_email: "buyer@example.com",
      customer: "cus_test_example",
      payment_method_options: {
        us_bank_account: {
          verification_method: "instant",
          financial_connections: {
            permissions: ["payment_method", "balances", "ownership", "transactions"],
            prefetch: ["balances", "ownership", "transactions"]
          }
        },
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: { type: "us_bank_transfer" }
        }
      },
      metadata: { seller: "SET Business Consults", offer: "workflow-improvement-review-495-usd" }
    });
    expect(params).not.toHaveProperty("automatic_payment_methods");
    expect(options).toEqual({ idempotencyKey: "checkout_retry_12345678" });
  });

  it("uses the explicit EUR allowlist without creating a Customer", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "pi_test_eur",
      client_secret: "pi_test_eur_secret_example",
      status: "requires_action"
    });
    const createCustomer = vi.fn();
    const stripe = {
      customers: { create: createCustomer },
      paymentIntents: { create, retrieve: vi.fn() }
    } as unknown as Stripe;
    const integration = createStripeIntegration(
      stripe,
      {
        port: 4242,
        applicationBaseUrl: "http://127.0.0.1:4242",
        stripeApiKey: ["rk", "test", "unitvalue"].join("_"),
        stripePublishableKey: ["pk", "test", "unitvalue"].join("_")
      },
      { read: vi.fn().mockResolvedValue({}), write: vi.fn() }
    );

    const offer = getCheckoutOffer("workflow-improvement-review-297-eur")!;
    await integration.createAndConfirmPaymentIntent(offer, "ct_test_eur", "buyer@example.com", "checkout_retry_eur");

    expect(createCustomer).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 29_700,
        currency: "eur",
        allowed_payment_method_types: ["card", "bizum", "eps", "mb_way", "multibanco"],
        metadata: expect.objectContaining({ offer: "workflow-improvement-review-297-eur" })
      }),
      { idempotencyKey: "checkout_retry_eur" }
    );
    const [params] = create.mock.calls[0]!;
    expect(params).not.toHaveProperty("automatic_payment_methods");
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("payment_method_options");
  });
});
