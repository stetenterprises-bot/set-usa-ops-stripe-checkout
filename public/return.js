const title = document.querySelector("#status-title");
const message = document.querySelector("#status-message");
const sessionId = new URLSearchParams(window.location.search).get("session_id");

async function showStatus() {
  if (!sessionId) {
    title.textContent = "Payment status unavailable";
    message.textContent = "No Checkout Session was supplied.";
    return;
  }

  try {
    const response = await fetch(`/checkout/session/${encodeURIComponent(sessionId)}`);
    const session = await response.json();
    if (!response.ok) throw new Error(session.error ?? "Unable to retrieve payment status.");

    if (session.payment_status === "paid") {
      title.textContent = "Payment received";
      message.textContent = session.customer_email
        ? `A confirmation will be sent to ${session.customer_email}.`
        : "Your payment was completed successfully.";
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
