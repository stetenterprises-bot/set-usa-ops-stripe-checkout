const title = document.querySelector("#status-title");
const message = document.querySelector("#status-message");
const paymentIntentId = new URLSearchParams(window.location.search).get("payment_intent");

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

    if (paymentIntent.status === "succeeded") {
      title.textContent = "Payment received";
      message.textContent = "Your payment was completed successfully.";
      return;
    }

    title.textContent = "Payment processing";
    message.textContent = "Stripe is still processing this payment. Fulfillment begins only after webhook confirmation.";
  } catch (error) {
    title.textContent = "Payment status unavailable";
    message.textContent = error instanceof Error ? error.message : "Please contact SET Business Consults.";
  }
}

showStatus();
