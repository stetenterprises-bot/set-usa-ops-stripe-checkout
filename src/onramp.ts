import crypto from "node:crypto";
import type Stripe from "stripe";

const ONRAMP_PAIRS = [
  { network: "bitcoin", currency: "btc", label: "Bitcoin on Bitcoin" },
  { network: "ethereum", currency: "eth", label: "ETH on Ethereum" },
  { network: "ethereum", currency: "usdc", label: "USDC on Ethereum" },
  { network: "solana", currency: "sol", label: "SOL on Solana" },
  { network: "solana", currency: "usdc", label: "USDC on Solana" }
] as const;

export type OnrampPair = (typeof ONRAMP_PAIRS)[number];

export type CryptoOnrampSession = {
  id: string;
  client_secret?: string | null;
  livemode?: boolean;
  status?: string;
};

export function onrampPairs(): ReadonlyArray<OnrampPair> {
  return ONRAMP_PAIRS;
}

function normalizeWalletAddress(network: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (network === "ethereum") return /^0x[a-fA-F0-9]{40}$/.test(address) ? address : null;
  if (network === "bitcoin") return /^(?:bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address) ? address : null;
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
  return null;
}

export function validateOnrampRequest(body: unknown):
  | { ok: true; network: OnrampPair["network"]; currency: OnrampPair["currency"]; walletAddress: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "A JSON request body is required." };
  const candidate = body as Record<string, unknown>;
  if (candidate.confirmed !== true) {
    return { ok: false, error: "Confirm the wallet, network, and Stripe Onramp handoff before creating a session." };
  }
  const network = typeof candidate.network === "string" ? candidate.network.toLowerCase() : "";
  const currency = typeof candidate.currency === "string" ? candidate.currency.toLowerCase() : "";
  const pair = ONRAMP_PAIRS.find((item) => item.network === network && item.currency === currency);
  if (!pair) return { ok: false, error: "Select a supported cryptocurrency and network pair." };
  const walletAddress = normalizeWalletAddress(pair.network, candidate.walletAddress);
  if (!walletAddress) return { ok: false, error: `Enter a valid ${pair.network} wallet address.` };
  return { ok: true, network: pair.network, currency: pair.currency, walletAddress };
}

function normalizedIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value.replace(/^::ffff:/, "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : undefined;
}

export async function createEmbeddedOnrampSession(
  stripe: Stripe,
  input: { network: string; currency: string; walletAddress: string; customerIp?: string }
): Promise<CryptoOnrampSession> {
  const response = await stripe.rawRequest(
    "POST",
    "/v1/crypto/onramp_sessions",
    {
      transaction_details: {
        destination_currency: input.currency,
        destination_network: input.network
      },
      wallet_addresses: { [input.network]: input.walletAddress },
      ...(normalizedIp(input.customerIp) ? { customer_ip_address: normalizedIp(input.customerIp) } : {})
    },
    { idempotencyKey: `set-embedded-onramp-${crypto.randomUUID()}` }
  );
  return response.data as CryptoOnrampSession;
}
