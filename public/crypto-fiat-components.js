const statusNode = document.querySelector("#status");
const authForm = document.querySelector("#auth-form");
const authContainer = document.querySelector("#auth-container");
const purchasePanel = document.querySelector("#purchase-panel");
const purchaseForm = document.querySelector("#purchase-form");
const paymentContainer = document.querySelector("#payment-container");
const buyButton = document.querySelector("#buy-button");

let onramp;
let authIntentId;
let cryptoCustomerId;
let cryptoPaymentToken;

function setStatus(message, error = false) { statusNode.textContent = message; statusNode.classList.toggle("error", error); }

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Stripe could not complete this step."), { status: response.status });
  return data;
}

async function initialize() {
  const config = await jsonRequest("/crypto-fiat/components/config");
  for (let attempt = 0; attempt < 50 && typeof window.loadCryptoOnrampAndInitialize !== "function"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (typeof window.loadCryptoOnrampAndInitialize !== "function") throw new Error("Stripe Embedded Components did not load.");
  onramp = await window.loadCryptoOnrampAndInitialize(config.publishableKey, { theme: "stripe" });
  if (!onramp) throw new Error("Stripe Embedded Components is unavailable.");
  setStatus("Ready for Link authentication.");
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const phone = document.querySelector("#phone").value.trim();
  setStatus("Starting Link authentication…");
  try {
    let result;
    try { result = await jsonRequest("/crypto-fiat/components/link-auth-intent", { method: "POST", body: JSON.stringify({ email }) }); }
    catch (error) { if (error.status !== 404) throw error; await onramp.registerLinkUser(email, phone, "US"); result = await jsonRequest("/crypto-fiat/components/link-auth-intent", { method: "POST", body: JSON.stringify({ email }) }); }
    authIntentId = result.authIntentId;
    const element = await onramp.authenticate(authIntentId, async ({ crypto_customer_id: customerId }) => { cryptoCustomerId = customerId; authContainer.replaceChildren(); authForm.hidden = true; purchasePanel.hidden = false; setStatus("Link authorized. Confirm your Base wallet and amount."); });
    authContainer.replaceChildren(element);
  } catch (error) { setStatus(error.message, true); }
});

purchaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const walletAddress = document.querySelector("#wallet-address").value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return setStatus("Enter a valid Base wallet address.", true);
  setStatus("Registering the wallet and loading Stripe payment controls…");
  try {
    await onramp.registerWalletAddress(walletAddress, "base");
    const element = await onramp.collectPaymentMethod({ payment_method_types: ["card"], wallets: { applePay: "auto", googlePay: "auto" } }, ({ cryptoPaymentToken: token }) => { cryptoPaymentToken = token; buyButton.hidden = false; setStatus("Payment method ready. Review and buy USDC."); });
    paymentContainer.replaceChildren(element);
  } catch (error) { setStatus(error.message || "Stripe could not prepare payment.", true); }
});

buyButton.addEventListener("click", async () => {
  const walletAddress = document.querySelector("#wallet-address").value.trim();
  const sourceAmount = Number(document.querySelector("#amount").value);
  if (!authIntentId || !cryptoCustomerId || !cryptoPaymentToken) return setStatus("Complete Link and payment authorization first.", true);
  buyButton.disabled = true; setStatus("Creating a Stripe quote…");
  try {
    const session = await jsonRequest("/crypto-fiat/components/session", { method: "POST", body: JSON.stringify({ authIntentId, cryptoCustomerId, paymentToken: cryptoPaymentToken, sourceAmount, walletAddress }) });
    if (!session.quoteExpiresAt || Math.floor(Date.now() / 1000) >= session.quoteExpiresAt) await jsonRequest(`/crypto-fiat/components/session/${encodeURIComponent(session.id)}/quote`, { method: "POST", body: JSON.stringify({ authIntentId }) });
    await onramp.performCheckout(session.id, async () => { const checkout = await jsonRequest(`/crypto-fiat/components/session/${encodeURIComponent(session.id)}/checkout`, { method: "POST", body: JSON.stringify({ authIntentId }) }); return checkout.client_secret; });
    setStatus("Purchase submitted. Stripe will report final on-chain fulfillment through the configured webhook.");
  } catch (error) { setStatus(error.message || "The purchase could not be completed.", true); buyButton.disabled = false; }
});

initialize().catch((error) => { authForm.querySelector("button").disabled = true; setStatus(error.message, true); });
