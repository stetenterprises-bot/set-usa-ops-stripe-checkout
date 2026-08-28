const title = document.querySelector("#status-title");
const message = document.querySelector("#status-message");
const paymentIntentId = new URLSearchParams(window.location.search).get("payment_intent");
const successfulPurchaseUrl = "https://ledgerline-compliance.sthomas935.chatgpt.site/thank-you";

async function showStatus() {
  if (!paymentIntentId) {
    title.textContent = "Payment status unavailable";
    message.textContent = "No PaymentIntent was supplied.";
    return;
  }

  try {
    const response = await fetch(`/checkout/payment-intent/${encodeURIComponent(paymentIntentId)}`);
    const paymentIntent = await response.json();
    if (!response.ok) throw new Error(paymentIntent.error ?? "Unable to retrieve payment status.");

    switch (paymentIntent.status) {
      case "succeeded":
        title.textContent = "Payment received";
        message.textContent = "Your payment was completed. Redirecting to confirmation and next steps…";
        window.location.replace(successfulPurchaseUrl);
        return;
      case "processing":
        title.textContent = "Payment processing";
        message.textContent = "Stripe is still processing this payment. SET will begin fulfillment only after webhook confirmation.";
        return;
      case "requires_payment_method":
        title.textContent = "Payment not completed";
        message.textContent = "The payment method was not accepted. Return to checkout to try another available method.";
        return;
      case "canceled":
        title.textContent = "Payment canceled";
        message.textContent = "This payment was canceled and no fulfillment will begin.";
        return;
      default:
        title.textContent = "Payment awaiting completion";
        message.textContent = "Additional payment steps may still be required. Return to checkout or contact SET Business Consults.";
    }
  } catch (error) {
    title.textContent = "Payment status unavailable";
    message.textContent = error instanceof Error ? error.message : "Please contact SET Business Consults.";
  }
}

showStatus();
