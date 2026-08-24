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

    const stripe = Stripe(publishableKey);
    const elements = stripe.elements({
      mode: "payment",
      amount: 49_500,
      currency: "usd",
      paymentMethodCreation: "manual",
      appearance: {
        theme: "stripe",
        variables: { colorPrimary: "#c97c4e", borderRadius: "10px" }
      }
    });
    const paymentElement = elements.create("payment", { layout: "accordion" });
    paymentElement.mount("#payment-element");

    loading.hidden = true;
    form.hidden = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      message.textContent = "";
      try {
        const { error: submitError } = await elements.submit();
        if (submitError) throw new Error(submitError.message);

        const { error: tokenError, confirmationToken } = await stripe.createConfirmationToken({
          elements,
          params: { return_url: `${window.location.origin}/checkout/return` }
        });
        if (tokenError) throw new Error(tokenError.message);
        if (!confirmationToken) throw new Error("Stripe did not return a ConfirmationToken.");

        const idempotencyKey = crypto.randomUUID().replaceAll("-", "_");
        const response = await fetch("/checkout/confirm-intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify({ confirmationTokenId: confirmationToken.id })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to confirm the payment.");

        if (result.status === "requires_action") {
          const { error: actionError } = await stripe.handleNextAction({ clientSecret: result.clientSecret });
          if (actionError) throw new Error(actionError.message);
        }

        window.location.assign(`/checkout/return?payment_intent=${encodeURIComponent(result.paymentIntentId)}`);
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
