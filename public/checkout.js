const loading = document.querySelector("#checkout-loading");
const form = document.querySelector("#payment-form");
const submitButton = document.querySelector("#submit");
const message = document.querySelector("#payment-message");

function showError(error) {
  message.textContent = error instanceof Error ? error.message : "Checkout could not be loaded. Please try again.";
  loading.hidden = true;
}

async function initializeCheckout() {
  try {
    const configResponse = await fetch("/checkout/config");
    if (!configResponse.ok) throw new Error("Stripe test checkout is not configured.");
    const { publishableKey } = await configResponse.json();

    const idempotencyKey = crypto.randomUUID().replaceAll("-", "_");
    const clientSecret = fetch("/checkout/session", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey }
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create Checkout Session.");
      return body.client_secret;
    });

    const stripe = Stripe(publishableKey);
    const checkout = stripe.initCheckoutElementsSdk({ clientSecret });
    const contactDetails = checkout.createContactDetailsElement();
    const paymentElement = checkout.createPaymentElement();
    contactDetails.mount("#contact-details-element");
    paymentElement.mount("#payment-element");

    loading.hidden = true;
    form.hidden = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      message.textContent = "";
      try {
        const loadActionsResult = await checkout.loadActions();
        if (loadActionsResult.type !== "success") {
          throw new Error("Checkout is not ready. Please review your payment details.");
        }
        const result = await loadActionsResult.actions.confirm();
        if (result?.error) throw new Error(result.error.message);
      } catch (error) {
        showError(error);
        submitButton.disabled = false;
      }
    });
  } catch (error) {
    showError(error);
  }
}

initializeCheckout();
