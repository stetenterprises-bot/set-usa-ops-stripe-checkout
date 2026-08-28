import type Stripe from "stripe";

export type CheckoutOfferId =
  | "workflow-improvement-review-495-usd"
  | "workflow-improvement-review-297-usd"
  | "workflow-improvement-review-297-eur"
  | "open-payment";

export type CheckoutOffer = {
  id: CheckoutOfferId;
  title: string;
  description: string;
  amount: number;
  currency: "usd" | "eur";
  paymentMethodTypes: Stripe.PaymentIntentCreateParams.AllowedPaymentMethodType[];
  customerBalanceBankTransferType?: "us_bank_transfer";
  openAmount?: boolean;
};

const usdPaymentMethodTypes: Stripe.PaymentIntentCreateParams.AllowedPaymentMethodType[] = [
  "card",
  "cashapp",
  "crypto",
  "us_bank_account",
  "customer_balance"
];

const eurPaymentMethodTypes: Stripe.PaymentIntentCreateParams.AllowedPaymentMethodType[] = [
  "card",
  "bizum",
  "eps",
  "mb_way",
  "multibanco"
];

const offers: Record<CheckoutOfferId, CheckoutOffer> = {
  "workflow-improvement-review-495-usd": {
    id: "workflow-improvement-review-495-usd",
    title: "Workflow Improvement Review",
    description: "A focused operational review with prioritized findings and next-step recommendations.",
    amount: 49_500,
    currency: "usd",
    paymentMethodTypes: usdPaymentMethodTypes,
    customerBalanceBankTransferType: "us_bank_transfer"
  },
  "workflow-improvement-review-297-usd": {
    id: "workflow-improvement-review-297-usd",
    title: "Workflow Improvement Review",
    description: "A focused operational review with prioritized findings and next-step recommendations.",
    amount: 29_700,
    currency: "usd",
    paymentMethodTypes: usdPaymentMethodTypes,
    customerBalanceBankTransferType: "us_bank_transfer"
  },
  "workflow-improvement-review-297-eur": {
    id: "workflow-improvement-review-297-eur",
    title: "Workflow Improvement Review",
    description: "A focused operational review with prioritized findings and next-step recommendations.",
    amount: 29_700,
    currency: "eur",
    paymentMethodTypes: eurPaymentMethodTypes
  },
  "open-payment": {
    id: "open-payment",
    title: "Open Payment",
    description: "Enter the amount you want to pay, choose USD or EUR, and complete the secure payment flow.",
    amount: 100,
    currency: "usd",
    paymentMethodTypes: usdPaymentMethodTypes,
    customerBalanceBankTransferType: "us_bank_transfer",
    openAmount: true
  }
};

export const defaultCheckoutOfferId: CheckoutOfferId = "workflow-improvement-review-495-usd";

export function getCheckoutOffer(value: string): CheckoutOffer | undefined {
  return offers[value as CheckoutOfferId];
}

export function checkoutOfferClientConfig(offer: CheckoutOffer) {
  return {
    id: offer.id,
    title: offer.title,
    description: offer.description,
    amount: offer.amount,
    currency: offer.currency,
    paymentMethodTypes: [...offer.paymentMethodTypes],
    openAmount: offer.openAmount ?? false,
    currencies: offer.openAmount ? ["usd", "eur"] : [offer.currency],
    paymentMethodTypesByCurrency: offer.openAmount ? {
      usd: [...usdPaymentMethodTypes],
      eur: [...eurPaymentMethodTypes]
    } : undefined
  };
}
