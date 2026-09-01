import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRIVY_APPROVED_APP_ID,
  PrivyBridgeError,
  PrivyPurchaseBridge,
  extractPrivyBearerToken,
  verifyPrivyAccessToken,
  type PrivyWalletApi,
  type PrivyWalletRecord
} from "../src/privy-bridge.js";

const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = keyPair.publicKey.export({ format: "jwk" }) as JsonWebKey;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function accessToken(overrides: Record<string, unknown> = {}): string {
  const header = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    sid: "session_1",
    sub: "did:privy:user_1",
    iss: "privy.io",
    aud: PRIVY_APPROVED_APP_ID,
    iat: 1_700_000_000,
    exp: 2_000_000_000,
    ...overrides
  }));
  const signingInput = `${header}.${payload}`;
  const der = crypto.sign("sha256", Buffer.from(signingInput), keyPair.privateKey);
  const sequence = der.subarray(2, 2 + der[1]!);
  let offset = 2;
  if (sequence[0] !== 0x02) throw new Error("unexpected signature");
  const rLength = sequence[1]!;
  const r = sequence.subarray(2, 2 + rLength);
  offset = 2 + rLength;
  if (sequence[offset] !== 0x02) throw new Error("unexpected signature");
  const sLength = sequence[offset + 1]!;
  const s = sequence.subarray(offset + 2, offset + 2 + sLength);
  const toRaw = (value: Buffer): Buffer => {
    let result = value;
    while (result.length > 32 && result[0] === 0) result = result.subarray(1);
    return Buffer.concat([Buffer.alloc(32 - result.length), result]);
  };
  return `${signingInput}.${base64Url(Buffer.concat([toRaw(r), toRaw(s)]))}`;
}

const wallet: PrivyWalletRecord = {
  id: "wallet_1",
  address: "0x0000000000000000000000000000000000000001",
  chain_type: "ethereum",
  owner_id: "provider-owned-user-key-quorum",
  created_at: 1_700_000_000_000
};

function fakeApi(wallets: readonly PrivyWalletRecord[] = []): PrivyWalletApi & { creates: number; lastCreate?: Parameters<PrivyWalletApi["createUserWallet"]>[0] } {
  const state = { creates: 0 } as PrivyWalletApi & { creates: number; lastCreate?: Parameters<PrivyWalletApi["createUserWallet"]>[0] };
  state.listUserWallets = async () => wallets;
  state.createUserWallet = async (input) => {
    state.creates += 1;
    state.lastCreate = input;
    return wallet;
  };
  return state;
}

describe("Privy customer-owned purchasing bridge", () => {
  it("requires the approved app and a configured verification path", () => {
    expect(() => new PrivyPurchaseBridge({ appId: "wrong-app", appSecret: "secret", verificationKey: publicJwk })).toThrow(/approved app/);
    expect(() => new PrivyPurchaseBridge({ appId: PRIVY_APPROVED_APP_ID, appSecret: "secret" })).toThrow(/verification/);
    expect(() => verifyPrivyAccessToken("eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.signature", {})).toThrow(/not configured/);
  });

  it("verifies signature, issuer, audience, subject, and expiry", () => {
    const claims = verifyPrivyAccessToken(accessToken(), { verificationKey: publicJwk, now: () => 1_800_000_000_000 });
    expect(claims).toMatchObject({ userId: "did:privy:user_1", sessionId: "session_1", appId: PRIVY_APPROVED_APP_ID, issuer: "privy.io" });
    expect(() => verifyPrivyAccessToken(accessToken({ aud: "other-app" }), { verificationKey: publicJwk })).toThrow(/invalid/);
    expect(() => verifyPrivyAccessToken(accessToken({ iss: "other-issuer" }), { verificationKey: publicJwk })).toThrow(/invalid/);
    expect(() => verifyPrivyAccessToken(accessToken({ exp: 1_600_000_000 }), { verificationKey: publicJwk, now: () => 1_700_000_000_000 })).toThrow(/invalid/);
  });

  it("accepts only a bearer token and never returns token material", () => {
    expect(extractPrivyBearerToken("Bearer token-value")).toBe("token-value");
    expect(extractPrivyBearerToken("bearer token-value")).toBe("token-value");
    expect(() => extractPrivyBearerToken("Basic token-value")).toThrow(/bearer/);
    expect(() => extractPrivyBearerToken("Bearer token value")).toThrow(/bearer/);
  });

  it("stops for customer confirmation when an existing compatible wallet is found", async () => {
    const api = fakeApi([wallet]);
    const bridge = new PrivyPurchaseBridge({ appId: PRIVY_APPROVED_APP_ID, verificationKey: publicJwk, api });
    const result = await bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_1", network: "ethereum", idempotencyKey: "set-wallet-1" });
    expect(result).toMatchObject({ status: "awaiting_wallet_confirmation", privyUserId: "did:privy:user_1", network: "ethereum" });
    expect(result.status === "awaiting_wallet_confirmation" ? result.candidates[0] : null).toEqual({ id: wallet.id, address: wallet.address, network: "ethereum", ownership: "user_owned" });
    expect(api.creates).toBe(0);
  });

  it("reuses only a wallet returned by the user-filtered Privy query", async () => {
    const api = fakeApi([wallet]);
    const bridge = new PrivyPurchaseBridge({ appId: PRIVY_APPROVED_APP_ID, verificationKey: publicJwk, api });
    const result = await bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_2", network: "ethereum", idempotencyKey: "set-wallet-2", reuseConfirmedWalletId: "wallet_1" });
    expect(result).toMatchObject({ status: "wallet_reused", wallet: { id: "wallet_1", address: wallet.address, ownership: "user_owned" } });
    await expect(bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_3", network: "ethereum", idempotencyKey: "set-wallet-3", reuseConfirmedWalletId: "unknown" })).rejects.toMatchObject({ code: "invalid_request", status: 403 });
  });

  it("creates a user-owned wallet only after explicit confirmation and keeps retries idempotent", async () => {
    const api = fakeApi();
    const bridge = new PrivyPurchaseBridge({ appId: PRIVY_APPROVED_APP_ID, verificationKey: publicJwk, api });
    const input = { authorization: `Bearer ${accessToken()}`, requestId: "req_4", network: "ethereum", idempotencyKey: "set-wallet-4" };
    const pending = await bridge.prepareWallet(input);
    expect(pending.status).toBe("awaiting_wallet_creation_confirmation");
    expect(api.creates).toBe(0);
    const created = await bridge.prepareWallet({ ...input, idempotencyKey: "set-wallet-4-confirmed", createWalletConfirmed: true });
    expect(created).toMatchObject({ status: "wallet_created", wallet: { id: "wallet_1", address: wallet.address, ownership: "user_owned" } });
    expect(api.lastCreate).toMatchObject({ userId: "did:privy:user_1", chainType: "ethereum", idempotencyKey: "set-wallet-4-confirmed" });
    expect(api.lastCreate?.externalId).toMatch(/^set-[a-f0-9]{48}$/);
    const retry = await bridge.prepareWallet({ ...input, idempotencyKey: "set-wallet-4-confirmed", createWalletConfirmed: true });
    expect(retry).toEqual(created);
    expect(api.creates).toBe(1);
  });

  it("uses the documented Privy owner field and idempotency header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return calls.length === 1
        ? new Response(JSON.stringify({ data: [] }), { status: 200 })
        : new Response(JSON.stringify(wallet), { status: 200 });
    };
    const bridge = new PrivyPurchaseBridge({
      appId: PRIVY_APPROVED_APP_ID,
      appSecret: "app-secret-not-logged",
      verificationKey: publicJwk,
      apiBaseUrl: "https://privy.test",
      fetchImplementation
    });
    await bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_7", network: "ethereum", idempotencyKey: "set-wallet-7", createWalletConfirmed: true });
    expect(calls[0]?.url).toContain("/v1/wallets?");
    expect(calls[1]?.url).toBe("https://privy.test/v1/wallets");
    expect(calls[1]?.init.headers).toMatchObject({ "privy-app-id": PRIVY_APPROVED_APP_ID, "privy-idempotency-key": "set-wallet-7" });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ chain_type: "ethereum", owner: { user_id: "did:privy:user_1" } });
  });

  it("rejects idempotency-key reuse for a different authenticated operation", async () => {
    const bridge = new PrivyPurchaseBridge({ appId: PRIVY_APPROVED_APP_ID, verificationKey: publicJwk, api: fakeApi() });
    await bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_5", network: "ethereum", idempotencyKey: "set-wallet-5", createWalletConfirmed: true });
    await expect(bridge.prepareWallet({ authorization: `Bearer ${accessToken()}`, requestId: "req_6", network: "ethereum", idempotencyKey: "set-wallet-5", createWalletConfirmed: true })).rejects.toBeInstanceOf(PrivyBridgeError);
  });
});
