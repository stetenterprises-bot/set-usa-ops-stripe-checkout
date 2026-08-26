import { isCommerceReadiness, readinessGates } from "./readiness";

describe("commerce readiness", () => {
  const readiness = {
    ok: true as const,
    mppConfigured: true,
    privyConfigured: false,
    checkoutConfigured: true,
    paymentWebhookConfigured: true,
    appEventsConfigured: false,
    durableEventStoreConfigured: true,
    executionAuthorized: false as const
  };

  it("normalizes the publication gates", () => {
    expect(readinessGates(readiness)).toEqual([
      { label: "Machine payments", ready: true },
      { label: "Privy wallet and onramp", ready: false },
      { label: "Checkout", ready: true },
      { label: "Payment webhooks", ready: true },
      { label: "App event endpoint", ready: false },
      { label: "Durable event storage", ready: true }
    ]);
  });

  it("rejects an execution-authorized response", () => {
    expect(isCommerceReadiness(readiness)).toBe(true);
    expect(isCommerceReadiness({ ...readiness, executionAuthorized: true })).toBe(false);
  });
});
