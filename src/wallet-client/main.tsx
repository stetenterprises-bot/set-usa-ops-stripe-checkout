import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import "./styles.css";

type WalletConfig = { privyAppId: string; stripePublishableKey: string };
type Wallet = { id: string; address: string; network: string; ownership: string };
type Purchase = { requestId: string; state: string; asset: string; network: string; wallet: { id: string; address: string; chainType: string } | null; sessionId: string | null; transactionId: string | null; deliveredAmount: string | null };
type WalletResult = { status: string; network?: string; candidates?: Wallet[]; wallet?: Wallet };
type QuoteReview = {
  purchase: Purchase;
  quote: { quote?: { sourceAmount?: string | null; destinationAmount?: string | null; [key: string]: unknown }; sourceTotalAmount?: string | null; fees?: Record<string, unknown>; [key: string]: unknown };
  constraintReview: {
    requestedSourceBudget: string | null;
    requestedDestinationAmount: string | null;
    quotedSourceTotalAmount: string | null;
    estimatedDestinationAmount: string | null;
    withinSourceBudget: boolean | null;
    destinationTargetMatched: boolean | null;
  };
  approval: { digest: string; nonce: string; expiresAt: string; walletAddress: string };
};
type SessionResult = { purchase: Purchase; clientSecret: string; sessionId: string };

declare global {
  interface Window {
    StripeOnramp?: (publishableKey: string) => {
      createSession: (options: { clientSecret: string }) => {
        addEventListener: (event: string, listener: (event: { payload?: { [key: string]: unknown } }) => void) => void;
        mount: (selector: string) => void;
      };
    };
  }
}

const assetOptions = [
  { value: "btc|bitcoin|bitcoin-segwit", label: "BTC on Bitcoin" },
  { value: "eth|ethereum|ethereum", label: "ETH on Ethereum" },
  { value: "usdc|base|ethereum", label: "USDC on Base" },
  { value: "usdc|ethereum|ethereum", label: "USDC on Ethereum" },
  { value: "sol|solana|solana", label: "SOL on Solana" }
] as const;

function idempotencyKey(prefix: string, requestId: string): string {
  return `${prefix}-${requestId}-${crypto.randomUUID()}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return "pending";
}

async function readJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${response.status}).`);
  }
  return body;
}

function WalletFlow({ config }: { config: WalletConfig }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [assetChoice, setAssetChoice] = useState<string>(assetOptions[0].value);
  const [destinationAmount, setDestinationAmount] = useState("");
  const [sourceBudget, setSourceBudget] = useState("");
  const [geography, setGeography] = useState("");
  const [postPurchase, setPostPurchase] = useState("none");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [walletResult, setWalletResult] = useState<WalletResult | null>(null);
  const [review, setReview] = useState<QuoteReview | null>(null);
  const [session, setSession] = useState<SessionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Authenticate to begin.");
  const [overageConfirmed, setOverageConfirmed] = useState(false);
  const [stripeState, setStripeState] = useState("Stripe Onramp has not started.");
  const [dashboardSync, setDashboardSync] = useState("");
  const stripeMounted = useRef(false);
  const operationKeys = useRef(new Map<string, string>());
  const createRequestKey = useRef<string | null>(null);
  const [asset, network, walletChainType] = assetChoice.split("|");

  const operationKey = useCallback((operation: string, requestId: string): string => {
    const key = `${operation}:${requestId}`;
    const existing = operationKeys.current.get(key);
    if (existing) return existing;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(`set.wallet.operation.${key}`); } catch { /* Storage is optional. */ }
    const created = saved ?? idempotencyKey(operation, requestId);
    try { sessionStorage.setItem(`set.wallet.operation.${key}`, created); } catch { /* Storage is optional. */ }
    operationKeys.current.set(key, created);
    return created;
  }, []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    if (!token) throw new Error("Privy authentication is required for this action.");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getAccessToken]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = await authHeaders();
    return readJson(await fetch(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }));
  }, [authHeaders]);

  const showError = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "The wallet flow could not continue.");
    setBusy(null);
  };

  const prepareWallet = async (requestId: string, options: { createWalletConfirmed?: boolean; reuseConfirmedWalletId?: string } = {}) => {
    const body = { walletChainType, ...(options.createWalletConfirmed ? { createWalletConfirmed: true } : {}), ...(options.reuseConfirmedWalletId ? { reuseConfirmedWalletId: options.reuseConfirmedWalletId } : {}) };
    const result = await request(`/purchasing/requests/${encodeURIComponent(requestId)}/wallet`, {
      method: "POST",
      headers: { "Idempotency-Key": operationKey(options.reuseConfirmedWalletId ? "confirm-wallet" : options.createWalletConfirmed ? "create-wallet" : "prepare-wallet", requestId) },
      body: JSON.stringify(body)
    });
    setWalletResult(result.result);
    setPurchase(result.purchase);
    if (result.result.status === "awaiting_wallet_creation_confirmation") {
      setStatusMessage("No compatible wallet exists. Confirm below if you want Privy to create your user-owned wallet.");
    } else if (result.result.status === "awaiting_wallet_confirmation") {
      setStatusMessage("Review the user-owned wallet address and confirm it before requesting a quote.");
    } else if (result.result.status === "wallet_created") {
      setStatusMessage("Privy created the user-owned wallet after your confirmation. Review its address below.");
    }
  };

  const startRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (purchase) return;
    if (!destinationAmount && !sourceBudget) { setError("Enter a crypto amount or USD budget."); return; }
    const requestKey = createRequestKey.current ?? idempotencyKey("create-request", "new");
    createRequestKey.current = requestKey;
    setBusy("Creating request"); setError(null); setReview(null); setSession(null); stripeMounted.current = false;
    try {
      const exactAnswers = { cryptocurrency: asset, cryptocurrency_amount: destinationAmount || "provider quote", payment: sourceBudget ? `USD budget ${sourceBudget}` : "provider quote", post_purchase: postPurchase };
      const body = { exact_answers: exactAnswers, destination_asset: asset, destination_network: network, destination_amount: destinationAmount || null, source_currency: "usd", source_budget: sourceBudget || null, customer_geography: geography, post_purchase_intent: postPurchase };
      const result = await request("/purchasing/requests", { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify(body) });
      try { window.sessionStorage.setItem("set.wallet.requestId", result.purchase.requestId); } catch { /* Storage may be disabled; the live flow remains usable. */ }
      setPurchase(result.purchase); setStatusMessage("Request created. Looking for your compatible Privy wallet.");
      setBusy(null);
      if (["intake", "awaiting_authentication", "authenticated", "awaiting_wallet"].includes(result.purchase.state)) {
        setBusy("Preparing wallet"); await prepareWallet(result.purchase.requestId); setBusy(null);
      }
    } catch (cause) { showError(cause); }
  };

  const confirmWallet = async (walletId: string) => {
    if (!purchase) return;
    setBusy("Confirming wallet"); setError(null);
    try {
      if (purchase.state === "awaiting_wallet") await prepareWallet(purchase.requestId, { reuseConfirmedWalletId: walletId });
      const result = await request(`/purchasing/requests/${encodeURIComponent(purchase.requestId)}/wallet/confirm`, {
        method: "POST", headers: { "Idempotency-Key": operationKey("wallet-confirm", purchase.requestId) }, body: JSON.stringify({ walletId })
      });
      setPurchase(result.purchase); setStatusMessage("Wallet confirmed. Requesting a current Stripe quote.");
      await getQuote(purchase.requestId);
    } catch (cause) { showError(cause); }
  };

  const getQuote = async (requestId: string) => {
    setBusy("Requesting quote"); setError(null);
    try {
      const quote = await request(`/purchasing/requests/${encodeURIComponent(requestId)}/quote`, { method: "POST" }) as unknown as QuoteReview;
      setReview(quote); setPurchase(quote.purchase); setOverageConfirmed(false);
      try { sessionStorage.setItem(`set.wallet.review.${requestId}`, JSON.stringify(quote)); } catch { /* No access tokens or client secrets are stored. */ }
      setStatusMessage("Review the quote and approve the exact total before Stripe Onramp opens."); setBusy(null);
    } catch (cause) { showError(cause); }
  };

  const approve = async () => {
    if (!purchase || !review) return;
    setBusy("Opening Stripe Onramp"); setError(null);
    try {
      const result = await request(`/purchasing/requests/${encodeURIComponent(purchase.requestId)}/approve`, {
        method: "POST", body: JSON.stringify({ confirmed: true, digest: review.approval.digest, nonce: review.approval.nonce, ...(overageConfirmed ? { budgetOverageConfirmed: true } : {}) })
      });
      setSession(result as unknown as SessionResult); setPurchase(result.purchase); setBusy(null); setStatusMessage("Stripe Onramp is ready. Complete payment and any required verification in the embedded panel.");
    } catch (cause) { showError(cause); }
  };

  useEffect(() => {
    if (!session || stripeMounted.current) return;
    if (!window.StripeOnramp) { setError("The Stripe Onramp client did not load. Refresh and try again."); return; }
    stripeMounted.current = true;
    const client = window.StripeOnramp(config.stripePublishableKey);
    const embedded = client.createSession({ clientSecret: session.clientSecret });
    embedded.addEventListener("onramp_session_updated", (event) => {
      const next = event.payload?.status;
      if (typeof next === "string") setStripeState(`Stripe Onramp status: ${next}`);
    });
    embedded.mount("#stripe-onramp");
  }, [config.stripePublishableKey, session]);

  useEffect(() => {
    if (!purchase?.requestId || !authenticated) return;
    const terminal = new Set(["fulfillment_complete", "rejected", "canceled"]);
    let stopped = false;
    const poll = async () => {
      try {
        const result = await request(`/purchasing/requests/${encodeURIComponent(purchase.requestId)}`);
        if (!stopped) {
          setPurchase(result.purchase);
          setDashboardSync(result.dashboardSync?.status ?? "");
          if (terminal.has(result.purchase.state) && result.dashboardSync?.status !== "retry_pending") {
            setStatusMessage(`Purchase state: ${result.purchase.state}`);
            window.clearInterval(timer);
          }
        }
      } catch { /* Provider and browser retries are reflected by the next poll. */ }
    };
    const timer = window.setInterval(poll, 5000); void poll();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [authenticated, purchase?.requestId, request]);

  useEffect(() => {
    if (!ready || !authenticated || purchase) return;
    let requestId: string | null = null;
    try { requestId = window.sessionStorage.getItem("set.wallet.requestId"); } catch { /* Storage may be disabled. */ }
    if (!requestId) return;
    let stopped = false;
    void (async () => {
      try {
        const status = await request(`/purchasing/requests/${encodeURIComponent(requestId as string)}`);
        if (stopped) return;
        setPurchase(status.purchase);
        const choice = assetOptions.find((option) => option.value.startsWith(`${status.purchase.asset}|${status.purchase.network}|`));
        if (choice) setAssetChoice(choice.value);
        try {
          const saved = sessionStorage.getItem(`set.wallet.review.${requestId}`);
          if (saved) setReview(JSON.parse(saved) as QuoteReview);
        } catch { /* A fresh quote can be requested before a session exists. */ }
        if (status.purchase.state === "awaiting_customer" && status.purchase.sessionId) {
          const resumed = await request(`/purchasing/requests/${encodeURIComponent(requestId as string)}/resume`);
          if (!stopped) { setSession(resumed as unknown as SessionResult); setStatusMessage("Your existing Stripe Onramp session was restored. Continue payment in the embedded panel."); }
        } else if (!stopped) {
          setStatusMessage("Your existing purchase request was restored. Continue from the current review step.");
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Could not restore your request. Refresh to retry; your saved request is retained.");
      }
    })();
    return () => { stopped = true; };
  }, [authenticated, ready, request]);

  useEffect(() => {
    if (ready && !authenticated) {
      setPurchase(null); setReview(null); setSession(null); setWalletResult(null);
      stripeMounted.current = false;
    }
  }, [ready, authenticated]);

  const requiresOverage = review?.constraintReview.withinSourceBudget === false;
  const walletCandidates = walletResult?.candidates ?? (walletResult?.wallet ? [walletResult.wallet] : purchase?.wallet ? [{ ...purchase.wallet, network: purchase.network, ownership: "user" }] : []);

  if (!ready) return <main className="card"><p>Loading secure authentication…</p></main>;
  if (!authenticated) return <main className="card"><h1>Customer wallet</h1><p>Sign in with Privy to review a user-owned wallet and a current Stripe Onramp quote.</p><button onClick={login}>Sign in with Privy</button></main>;

  return <main className="shell">
    <header><div><p className="eyebrow">SET customer wallet</p><h1>Buy into your own wallet</h1><p className="lede">Privy authenticates you and Stripe handles payment and verification. The exact wallet, quote, approval, and fulfillment status stay visible at every step.</p></div><button className="secondary" onClick={logout}>Sign out</button></header>
    <section className="card"><h2>1. Define the purchase</h2><form onSubmit={startRequest}><fieldset disabled={Boolean(purchase || busy)}>
      <label>Asset and network<select value={assetChoice} onChange={(event) => setAssetChoice(event.target.value)}>{assetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <div className="grid"><label>Crypto amount (optional)<input inputMode="decimal" value={destinationAmount} onChange={(event) => setDestinationAmount(event.target.value)} placeholder="For example 0.01" /></label><label>USD budget (optional)<input inputMode="decimal" value={sourceBudget} onChange={(event) => setSourceBudget(event.target.value)} placeholder="For example 50" /></label></div>
      <div className="grid"><label>Customer geography<input value={geography} onChange={(event) => setGeography(event.target.value)} required placeholder="For example US-IL" /></label><label>After purchase<select value={postPurchase} onChange={(event) => setPostPurchase(event.target.value)}><option value="none">Hold in my wallet</option><option value="dapp">Use a separately approved dApp handoff</option></select></label></div>
      <p className="hint">Provide a crypto amount or a USD budget. No payment or wallet creation starts from this form.</p><button disabled={Boolean(busy || purchase)} type="submit">{busy ?? "Create purchase request"}</button>
    </fieldset></form></section>
    {purchase && ["intake", "awaiting_authentication", "authenticated", "awaiting_wallet"].includes(purchase.state) && !walletResult && <button disabled={Boolean(busy)} onClick={() => { setBusy("Preparing wallet"); void prepareWallet(purchase.requestId).then(() => setBusy(null)).catch(showError); }}>Continue wallet selection</button>}
    {purchase && !purchase.sessionId && ["awaiting_quote", "quote_ready", "awaiting_approval", "expired"].includes(purchase.state) && <button disabled={Boolean(busy)} onClick={() => void getQuote(purchase.requestId)}>Get a fresh quote</button>}
    {purchase?.state === "fulfillment_complete" && <section className="card"><h2>Delivery verified</h2><p>{purchase.deliveredAmount} {purchase.asset.toUpperCase()} to {purchase.wallet?.address}</p><p>Transaction <code>{purchase.transactionId}</code></p></section>}
    {dashboardSync === "synced" && <p className="status">Purchase activity is synced to your approved client workspace.</p>}
    {dashboardSync === "retry_pending" && <p className="status">Your purchase is retained. Client dashboard synchronization is retrying.</p>}
    {purchase && <section className="card"><h2>2. Wallet review</h2><p className="status">{statusMessage}</p><p>Request <code>{purchase.requestId}</code> · state <strong>{purchase.state}</strong></p>{walletResult?.status === "awaiting_wallet_creation_confirmation" && <button disabled={Boolean(busy)} onClick={() => { setBusy("Creating wallet"); void prepareWallet(purchase.requestId, { createWalletConfirmed: true }).then(() => setBusy(null)).catch(showError); }}>Confirm user-owned wallet creation</button>}{walletCandidates.length > 0 && <div className="wallet-list">{walletCandidates.map((wallet) => <div className="wallet" key={wallet.id}><code>{wallet.address}</code><span>{wallet.network}</span><button disabled={Boolean(busy) || !["awaiting_wallet", "awaiting_wallet_confirmation"].includes(purchase.state)} onClick={() => void confirmWallet(wallet.id)}>{busy ?? "Confirm this wallet"}</button></div>)}</div>}</section>}
    {review && !session && purchase && ["awaiting_approval", "approved", "session_creating", "reconciliation_required"].includes(purchase.state) && <section className="card"><h2>3. Quote and approval</h2><div className="quote"><p>Destination: <strong>{formatValue(review.constraintReview.estimatedDestinationAmount ?? review.quote.quote?.destinationAmount)} {purchase.asset.toUpperCase()}</strong></p><p>Quoted source total: <strong>{formatValue(review.constraintReview.quotedSourceTotalAmount ?? review.quote.sourceTotalAmount)} USD</strong></p><p>Wallet: <code>{review.approval.walletAddress}</code></p><p>Quote expires: <strong>{review.approval.expiresAt}</strong></p></div>{requiresOverage && <label className="check"><input type="checkbox" checked={overageConfirmed} onChange={(event) => setOverageConfirmed(event.target.checked)} /> I approve the quoted total above my original USD budget.</label>}<button disabled={Boolean(busy) || Boolean(requiresOverage && !overageConfirmed)} onClick={() => void approve()}>{busy ?? "Approve exact quote and open Stripe"}</button></section>}
    {session && <section className="card"><h2>4. Complete with Stripe</h2><p className="status">{stripeState}</p><p>{statusMessage}</p><div id="stripe-onramp" /></section>}
    {error && <div className="error" role="alert">{error}</div>}
  </main>;
}

function Bootstrap() {
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/wallet/config", { cache: "no-store" }).then(readJson).then((value) => setConfig(value as WalletConfig)).catch((cause) => setError(cause instanceof Error ? cause.message : "Wallet configuration is unavailable.")); }, []);
  if (error) return <main className="card"><h1>Customer wallet</h1><p className="error">{error}</p></main>;
  if (!config) return <main className="card"><p>Loading wallet configuration…</p></main>;
  return <PrivyProvider appId={config.privyAppId} config={{ embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } } }}><WalletFlow config={config} /></PrivyProvider>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Bootstrap /></React.StrictMode>);
