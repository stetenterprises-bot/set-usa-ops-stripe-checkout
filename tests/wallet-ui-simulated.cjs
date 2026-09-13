const path = require("node:path");
const { createServer } = require("vite");
const { chromium } = require("C:/Users/sthom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const root = path.resolve(__dirname, "../src/wallet-client");
const shim = path.resolve(__dirname, "privy-ui-shim.tsx");
const wallet = { id: "wallet_sim_1", address: "0x0000000000000000000000000000000000000001", chainType: "ethereum", network: "base", ownership: "user" };
const basePurchase = (state, extra = {}) => ({ requestId: "req_simulated_1", state, asset: "usdc", network: "base", wallet: state === "intake" ? null : wallet, sessionId: null, transactionId: null, deliveredAmount: null, ...extra });
const quote = { quote: { destinationAmount: "20.00", sourceAmount: "24.00" }, sourceTotalAmount: "25.50", fees: {}, constraintReview: { requestedSourceBudget: "25.00", requestedDestinationAmount: "20.00", quotedSourceTotalAmount: "25.50", estimatedDestinationAmount: "20.00", withinSourceBudget: false, destinationTargetMatched: true }, approval: { digest: "digest_simulated", nonce: "nonce_simulated", expiresAt: "2099-01-01T00:00:00.000Z", walletAddress: wallet.address } };
const session = { clientSecret: "cs_simulated", sessionId: "cos_simulated_1" };

function serverState() {
  let purchase = basePurchase("intake");
  return { purchase, retryResume: false, nestedStatus: "fulfillment_complete" };
}

async function main() {
  const { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } = await import('@hpke/core');
  const { Chacha20Poly1305 } = await import('@hpke/chacha20poly1305');
  const state = serverState();
  const server = await createServer({ root, base: "/", resolve: { alias: { "@privy-io/react-auth": shim } }, server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  try {
  await page.route("**/crypto-onramp-outer.js", async route => route.fulfill({ status: 200, contentType: "application/javascript", body: `window.StripeOnramp=()=>({createSession:()=>({addEventListener:(name,fn)=>{window.__onramp=fn},mount:()=>{document.querySelector('#stripe-onramp').textContent='Simulated Stripe Onramp'}})})` }));
  await page.route("**/wallet/config", async route => route.fulfill({ json: { privyAppId: "simulated-app", stripePublishableKey: "pk_test_simulated" } }));
  await page.route("**/purchasing/**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'POST' && url.pathname.endsWith('/wallet/export')) {
      const input = route.request().postDataJSON();
      if (input.confirmed !== true) throw new Error('Missing customer export confirmation');
      const publicKey = await crypto.subtle.importKey('spki', Buffer.from(input.recipientPublicKey, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
      const sender = await suite.createSenderContext({ recipientPublicKey: publicKey });
      const ciphertext = await sender.seal(new TextEncoder().encode('synthetic-browser-recovery-only'));
      return route.fulfill({ json: { encryption_type: 'HPKE', ciphertext: Buffer.from(ciphertext).toString('base64'), encapsulated_key: Buffer.from(sender.enc).toString('base64') } });
    }
    if (method === "POST" && url.pathname === "/purchasing/requests") { state.purchase = basePurchase("intake"); return route.fulfill({ json: { purchase: state.purchase } }); }
    if (method === "POST" && url.pathname.endsWith("/wallet")) { state.purchase = basePurchase("awaiting_wallet_confirmation"); return route.fulfill({ json: { purchase: state.purchase, result: { status: "awaiting_wallet_confirmation", candidates: [wallet] } } }); }
    if (method === "POST" && url.pathname.endsWith("/wallet/confirm")) { state.purchase = basePurchase("quote_ready"); return route.fulfill({ json: { purchase: state.purchase } }); }
    if (method === "POST" && url.pathname.endsWith("/quote")) { state.purchase = basePurchase("awaiting_approval"); return route.fulfill({ json: { purchase: state.purchase, ...quote } }); }
    if (method === "POST" && url.pathname.endsWith("/approve")) { state.purchase = basePurchase("awaiting_customer", { sessionId: session.sessionId }); return route.fulfill({ json: { purchase: state.purchase, ...session } }); }
    if (url.pathname.endsWith("/resume")) { if (state.retryResume) return route.fulfill({ status: 503, json: { error: "resume temporarily unavailable" } }); return route.fulfill({ json: { purchase: state.purchase, ...session } }); }
    if (method === "GET" && url.pathname.includes("/purchasing/requests/")) { return route.fulfill({ json: { purchase: state.purchase, dashboardSync: state.purchase.state === "fulfillment_complete" ? { status: "retry_pending" } : undefined } }); }
    return route.fulfill({ status: 404, json: { error: "unhandled simulated route" } });
  });
  await page.goto(`${base}/`);
  await page.getByLabel("Crypto amount (optional)").fill("20");
  await page.getByLabel("Customer geography").fill("US-IL");
  await page.getByRole("button", { name: "Create purchase request" }).click();
  await page.getByRole("button", { name: "Confirm this wallet" }).click();
  if (await page.getByRole('button', { name: 'Approve exact quote and open Stripe' }).isEnabled()) throw new Error('Over-budget quote did not require consent');
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve exact quote and open Stripe" }).click();
  await page.waitForSelector("#stripe-onramp");
  if (!(await page.locator("#stripe-onramp").textContent()).includes("Simulated Stripe Onramp")) throw new Error("Stripe mount was not exercised");
  await page.evaluate(() => window.__onramp({ payload: { session: { status: 'fulfillment_processing' } } }));
  await page.getByText('Stripe Onramp status: fulfillment_processing', { exact: true }).waitFor();
  if (await page.getByText('Delivery verified', { exact: true }).count()) throw new Error('Frontend event falsely claimed verified delivery');
  state.purchase = basePurchase("fulfillment_complete", { sessionId: session.sessionId, transactionId: "0xtx_simulated", deliveredAmount: "20.00" });
  await page.reload();
  await page.waitForTimeout(1000);
  if (!(await page.getByText(/Delivery verified/).count())) throw new Error("fulfillment UI did not render");
  state.purchase = basePurchase("awaiting_customer", { sessionId: session.sessionId });
  state.retryResume = true;
  await page.reload();
  await page.waitForTimeout(1000);
  if (!(await page.getByText(/resume temporarily unavailable/).count())) throw new Error(`resume failure was not surfaced: ${await page.locator('body').innerText()}`);
  state.retryResume = false;
  await page.getByRole('button', { name: 'Retry Stripe Onramp resume' }).click();
  await page.waitForTimeout(1000);
  if (!(await page.getByText(/existing Stripe Onramp session was restored/).count())) throw new Error("resume retry did not restore session");
  state.purchase = basePurchase("fulfillment_complete", { sessionId: session.sessionId, transactionId: "0xtx_nested", deliveredAmount: "20.00" });
  await page.reload();
  await page.waitForTimeout(1000);
  if (!(await page.getByText(/retrying/).count())) throw new Error("nested dashboardSync retry_pending status was not rendered");
  page.once('dialog', dialog => dialog.accept());
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download wallet recovery key', exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  if (Buffer.concat(chunks).toString() !== 'synthetic-browser-recovery-only') throw new Error('Browser HPKE recovery download failed');
  if ((await page.locator('body').innerText()).includes('synthetic-browser-recovery-only')) throw new Error('Plaintext key appeared in page');
  await page.getByRole('button', { name: 'Start another purchase', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'Create purchase request' }).isEnabled())) throw new Error('New purchase intake remained locked');
  console.log(JSON.stringify({ simulated: true, passed: ["intake-wallet-quote-approve", "budget-consent", "stripe-mount", "nested-stripe-event", "no-browser-event-fulfillment-claim", "fulfillment-complete", "resume-failure", "resume-button-retry", "nested-dashboardSync-retry_pending", "browser-only-encrypted-recovery-download", "explicit-next-purchase"] }));
  } finally {
  await browser.close();
  await server.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
