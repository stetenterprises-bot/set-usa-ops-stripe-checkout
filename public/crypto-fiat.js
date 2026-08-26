const form = document.querySelector("#onramp-form");
const pairSelect = document.querySelector("#pair");
const walletInput = document.querySelector("#wallet-address");
const confirmedInput = document.querySelector("#confirmed");
const setupPanel = document.querySelector("#setup-panel");
const onrampPanel = document.querySelector("#onramp-panel");
const onrampElement = document.querySelector("#onramp-element");
const statusElement = document.querySelector("#status");
const startOverButton = document.querySelector("#start-over");

let config;
let session;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.dataset.error = isError ? "true" : "false";
}

async function loadConfig() {
  const response = await fetch("/crypto-fiat/config", { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Crypto - Fiat is not configured.");
  config = data;
  for (const pair of config.pairs) {
    const option = document.createElement("option");
    option.value = `${pair.network}:${pair.currency}`;
    option.textContent = pair.label;
    pairSelect.append(option);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const [network, currency] = pairSelect.value.split(":");
  if (!network || !currency || !confirmedInput.checked) return;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  setStatus("Creating a secure Stripe Onramp session…");
  try {
    const response = await fetch("/crypto-fiat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ network, currency, walletAddress: walletInput.value, confirmed: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Stripe could not create the Onramp session.");
    const stripeOnramp = StripeOnramp(config.publishableKey);
    session = stripeOnramp
      .createSession({ clientSecret: data.clientSecret, appearance: { theme: "dark" } })
      .addEventListener("onramp_session_updated", (update) => {
        const state = update?.payload?.session?.status;
        if (state) setStatus(`Stripe Onramp status: ${state}.`);
      })
      .mount(onrampElement);
    setupPanel.hidden = true;
    onrampPanel.hidden = false;
    setStatus("");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to start Stripe Onramp.", true);
  } finally {
    button.disabled = false;
  }
});

startOverButton.addEventListener("click", () => {
  onrampElement.replaceChildren();
  session = undefined;
  onrampPanel.hidden = true;
  setupPanel.hidden = false;
  confirmedInput.checked = false;
  setStatus("");
});

loadConfig().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Crypto - Fiat is unavailable.", true);
  form.querySelector("button[type='submit']").disabled = true;
});
