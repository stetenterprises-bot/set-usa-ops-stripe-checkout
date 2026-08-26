export type CommerceReadiness = {
  ok: boolean;
  mppConfigured: boolean;
  privyConfigured: boolean;
  checkoutConfigured: boolean;
  paymentWebhookConfigured: boolean;
  appEventsConfigured: boolean;
  durableEventStoreConfigured: boolean;
  executionAuthorized: false;
};

export type ReadinessGate = {
  label: string;
  ready: boolean;
};

export function readinessGates(readiness: CommerceReadiness): ReadinessGate[] {
  return [
    { label: "Machine payments", ready: readiness.mppConfigured },
    { label: "Privy wallet and onramp", ready: readiness.privyConfigured },
    { label: "Checkout", ready: readiness.checkoutConfigured },
    { label: "Payment webhooks", ready: readiness.paymentWebhookConfigured },
    { label: "App event endpoint", ready: readiness.appEventsConfigured },
    { label: "Durable event storage", ready: readiness.durableEventStoreConfigured }
  ];
}

export function isCommerceReadiness(value: unknown): value is CommerceReadiness {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.ok === true
    && candidate.executionAuthorized === false
    && [
      "mppConfigured",
      "privyConfigured",
      "checkoutConfigured",
      "paymentWebhookConfigured",
      "appEventsConfigured",
      "durableEventStoreConfigured"
    ].every((key) => typeof candidate[key] === "boolean");
}
