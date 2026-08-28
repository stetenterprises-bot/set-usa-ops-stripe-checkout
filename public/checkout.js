const loading = document.querySelector("#checkout-loading");
const form = document.querySelector("#payment-form");
const submitButton = document.querySelector("#submit");
const message = document.querySelector("#payment-message");
const customerEmail = document.querySelector("#customer-email");
const offerTitle = document.querySelector("#offer-title");
const offerDescription = document.querySelector("#offer-description");
const offerAmount = document.querySelector("#offer-amount");
const offerCurrency = document.querySelector("#offer-currency");
const openPaymentFields = document.querySelector("#open-payment-fields");
const openAmount = document.querySelector("#open-amount");
const openCurrency = document.querySelector("#open-currency");

const checkoutBasePath = window.location.pathname.replace(/\/$/, "");

function formattedAmount(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase()
  }).format(amount / 100);
}

function showError(error) {
  message.textContent = error instanceof Error ? error.message : "Checkout could not be loaded. Please try again.";
  loading.hidden = true;
}

async function initializeCheckout() {
  try {
    const configResponse = await fetch(`${checkoutBasePath}/config`);
    if (!configResponse.ok) throw new Error("Stripe checkout is not configured.");
    const { publishableKey, offer } = await configResponse.json();
    const isOpenPayment = Boolean(offer.openAmount);

    offerTitle.textContent = offer.title;
    offerDescription.textContent = offer.description;
    offerAmount.textContent = isOpenPayment ? "Your amount" : formattedAmount(offer.amount, offer.currency);
    offerCurrency.textContent = isOpenPayment ? "Choose currency · one time" : `${offer.currency.toUpperCase()} · one time`;
    if (isOpenPayment) {
      openPaymentFields.hidden = false;
      openCurrency.replaceChildren(...offer.currencies.map((currency) => {
        const option = document.createElement("option");
        option.value = currency;
        option.textContent = currency.toUpperCase();
        return option;
      }));
    }
    submitButton.textContent = isOpenPayment ? "Continue to payment" : `Pay ${formattedAmount(offer.amount, offer.currency)}`;
    document.title = `${offer.title} | SET Business Consults`;

    const stripe = Stripe(publishableKey);
    const currentAmount = () => isOpenPayment ? Math.round(Number(openAmount.value) * 100) : offer.amount;
    const currentCurrency = () => isOpenPayment ? openCurrency.value : offer.currency;
    const elements = stripe.elements({
      mode: "payment",
      amount: isOpenPayment ? 100 : offer.amount,
      currency: isOpenPayment ? "usd" : offer.currency,
      paymentMethodTypes: isOpenPayment ? offer.paymentMethodTypesByCurrency.usd : offer.paymentMethodTypes,
      paymentMethodCreation: "manual",
      appearance: {
        theme: "night",
        variables: {
          colorPrimary: "#71e4b8",
          colorBackground: "#0c1c17",
          colorText: "#f4f7f6",
          colorDanger: "#ff9e91",
          borderRadius: "10px"
        }
      }
    });
    const paymentElement = elements.create("payment", { layout: "accordion" });
    paymentElement.mount("#payment-element");
    const refreshOpenPayment = () => {
      if (!isOpenPayment) return;
      const amount = currentAmount();
      const currency = currentCurrency();
      offerAmount.textContent = Number.isFinite(amount) && amount >= 100 ? formattedAmount(amount, currency) : "Your amount";
      offerCurrency.textContent = `${currency.toUpperCase()} · one time`;
      submitButton.textContent = Number.isFinite(amount) && amount >= 100 ? `Pay ${formattedAmount(amount, currency)}` : "Continue to payment";
      if (Number.isFinite(amount) && amount >= 100) {
        elements.update({ amount, currency, paymentMethodTypes: offer.paymentMethodTypesByCurrency[currency] });
      }
    };
    if (isOpenPayment) {
      openAmount.addEventListener("input", refreshOpenPayment);
      openCurrency.addEventListener("change", refreshOpenPayment);
    }
    let pendingAttempt = null;

    loading.hidden = true;
    form.hidden = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      message.textContent = "";
      try {
        if (!pendingAttempt) {
          if (!customerEmail.reportValidity()) throw new Error("Enter a valid email address.");
          if (isOpenPayment && (!Number.isInteger(currentAmount()) || currentAmount() < 100 || currentAmount() > 1_000_000)) {
            throw new Error("Enter an amount between 1.00 and 10,000.00.");
          }
          const { error: submitError } = await elements.submit();
          if (submitError) throw new Error(submitError.message);

          const { error: tokenError, confirmationToken } = await stripe.createConfirmationToken({
            elements,
            params: { return_url: `${window.location.origin}/checkout/return` }
          });
          if (tokenError) throw new Error(tokenError.message);
          if (!confirmationToken) throw new Error("Stripe did not return a ConfirmationToken.");

          pendingAttempt = {
            confirmationTokenId: confirmationToken.id,
            customerEmail: customerEmail.value.trim(),
            amount: isOpenPayment ? currentAmount() : undefined,
            currency: isOpenPayment ? currentCurrency() : undefined,
            idempotencyKey: crypto.randomUUID().replaceAll("-", "_")
          };
          customerEmail.disabled = true;
        }

        const response = await fetch(`${checkoutBasePath}/confirm-intent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": pendingAttempt.idempotencyKey
          },
          body: JSON.stringify({
            confirmationTokenId: pendingAttempt.confirmationTokenId,
            customerEmail: pendingAttempt.customerEmail,
            ...(isOpenPayment ? { amount: pendingAttempt.amount, currency: pendingAttempt.currency } : {})
          })
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
