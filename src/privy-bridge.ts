import crypto, { type KeyObject } from "node:crypto";

/** The only Privy application this project is permitted to use. */
export const PRIVY_APPROVED_APP_ID = "cmt7hoxq900i20cl79s3r6sva" as const;
export const PRIVY_DEFAULT_API_BASE_URL = "https://api.privy.io" as const;

const MAX_TOKEN_LENGTH = 16_384;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_LENGTH = 200;
const SUPPORTED_CHAIN_TYPES = new Set([
  "ethereum",
  "solana",
  "bitcoin-segwit",
  "bitcoin-taproot"
]);

export type PrivyVerificationKey = JsonWebKey | string | KeyObject;

export type VerifiedPrivyAccessToken = {
  userId: string;
  sessionId: string;
  appId: typeof PRIVY_APPROVED_APP_ID;
  issuer: "privy.io";
  issuedAt: number;
  expiration: number;
};

export type PrivyWalletRecord = {
  id: string;
  address: string;
  chain_type: string;
  owner_id?: string | null;
  custody?: unknown;
  created_at?: number;
  [key: string]: unknown;
};

export type PrivyWalletApi = {
  listUserWallets(input: { userId: string; chainType: string }): Promise<readonly PrivyWalletRecord[]>;
  createUserWallet(input: {
    userId: string;
    chainType: string;
    externalId: string;
    idempotencyKey: string;
  }): Promise<PrivyWalletRecord>;
};

export type WalletPreparationRequest = {
  authorization: string | undefined;
  requestId: string;
  network: string;
  idempotencyKey: string;
  /** A wallet ID is accepted only as a customer-confirmed reuse choice. */
  reuseConfirmedWalletId?: string;
  /** Required immediately before a new wallet is created. */
  createWalletConfirmed?: boolean;
  /** Alias retained for callers whose confirmation field is simply `confirmed`. */
  confirmed?: boolean;
};

export type PublicWallet = {
  id: string;
  address: string;
  network: string;
  ownership: "user_owned";
};

export type WalletPreparationResult =
  | {
      status: "wallet_created" | "wallet_reused";
      privyUserId: string;
      wallet: PublicWallet;
    }
  | {
      status: "awaiting_wallet_confirmation" | "awaiting_wallet_creation_confirmation";
      privyUserId: string;
      network: string;
      candidates: readonly PublicWallet[];
    };

export type PrivyBridgeErrorCode =
  | "configuration_required"
  | "invalid_request"
  | "invalid_authentication"
  | "invalid_token"
  | "idempotency_conflict"
  | "provider_error";

export class PrivyBridgeError extends Error {
  readonly code: PrivyBridgeErrorCode;
  readonly status: number;

  constructor(code: PrivyBridgeErrorCode, message: string, status = 400) {
    super(message);
    this.name = "PrivyBridgeError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: PrivyBridgeErrorCode, message: string, status?: number): never {
  throw new PrivyBridgeError(code, message, status);
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("invalid_token", "Privy access token is invalid.", 401);
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="), "base64");
}

function decodeJsonPart(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(value).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    fail("invalid_token", "Privy access token is invalid.", 401);
  }
}

function publicKeyFrom(value: PrivyVerificationKey): KeyObject {
  try {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{")) return crypto.createPublicKey({ key: JSON.parse(trimmed), format: "jwk" });
      return crypto.createPublicKey(trimmed);
    }
    if (value instanceof crypto.KeyObject) return value;
    return crypto.createPublicKey({ key: value as JsonWebKey, format: "jwk" });
  } catch {
    fail("configuration_required", "A valid Privy JWT verification key is required.", 503);
  }
}

function derEncodeEcdsaSignature(raw: Buffer): Buffer {
  if (raw.length !== 64) fail("invalid_token", "Privy access token is invalid.", 401);
  const integer = (part: Buffer): Buffer => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start += 1;
    let result = part.subarray(start);
    if ((result[0] ?? 0) & 0x80) result = Buffer.concat([Buffer.from([0]), result]);
    return result;
  };
  const r = integer(raw.subarray(0, 32));
  const s = integer(raw.subarray(32));
  const body = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function assertAccessClaims(payload: Record<string, unknown>, nowSeconds: number): VerifiedPrivyAccessToken {
  const userId = payload.sub;
  const sessionId = payload.sid;
  const issuer = payload.iss;
  const audience = payload.aud;
  const issuedAt = payload.iat;
  const expiration = payload.exp;
  const audienceMatches = audience === PRIVY_APPROVED_APP_ID || (Array.isArray(audience) && audience.includes(PRIVY_APPROVED_APP_ID));
  if (
    typeof userId !== "string" || !userId ||
    typeof sessionId !== "string" || !sessionId ||
    issuer !== "privy.io" ||
    !audienceMatches ||
    typeof issuedAt !== "number" || !Number.isFinite(issuedAt) ||
    typeof expiration !== "number" || !Number.isFinite(expiration) ||
    expiration <= nowSeconds || issuedAt > nowSeconds + 60 || expiration <= issuedAt
  ) {
    fail("invalid_token", "Privy access token is invalid.", 401);
  }
  return { userId, sessionId, appId: PRIVY_APPROVED_APP_ID, issuer: "privy.io", issuedAt, expiration };
}

/** Verify a Privy access JWT locally. No unverified claims are ever returned. */
export function verifyPrivyAccessToken(
  token: string,
  options: { verificationKey?: PrivyVerificationKey; now?: () => number }
): VerifiedPrivyAccessToken {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    fail("invalid_token", "Privy access token is invalid.", 401);
  }
  if (!options.verificationKey) fail("configuration_required", "Privy JWT verification is not configured.", 503);
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) fail("invalid_token", "Privy access token is invalid.", 401);
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) fail("invalid_token", "Privy access token is invalid.", 401);
  const header = decodeJsonPart(encodedHeader);
  const payload = decodeJsonPart(encodedPayload);
  const algorithm = header.alg;
  // The current Privy access-token contract documents ES256. Do not widen the
  // accepted algorithm set based on a stale or contradictory key description.
  if (algorithm !== "ES256") fail("invalid_token", "Privy access token is invalid.", 401);
  const key = publicKeyFrom(options.verificationKey);
  const keyAlgorithm = key.asymmetricKeyType;
  if (keyAlgorithm !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    fail("invalid_token", "Privy access token is invalid.", 401);
  }
  let valid = false;
  try {
    const signature = decodeBase64Url(encodedSignature);
    valid = crypto.verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`), key, derEncodeEcdsaSignature(signature));
  } catch {
    fail("invalid_token", "Privy access token is invalid.", 401);
  }
  if (!valid) fail("invalid_token", "Privy access token is invalid.", 401);
  return assertAccessClaims(payload, Math.floor((options.now?.() ?? Date.now()) / 1000));
}

export function extractPrivyBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== "string") fail("invalid_authentication", "A Privy bearer token is required.", 401);
  const value = authorization.trim();
  const space = value.indexOf(" ");
  if (space < 1 || !/^Bearer$/i.test(value.slice(0, space)) || !value.slice(space + 1).trim() || /\s/.test(value.slice(space + 1).trim())) {
    fail("invalid_authentication", "A Privy bearer token is required.", 401);
  }
  return value.slice(space + 1).trim();
}

function validateRequest(input: WalletPreparationRequest): { requestId: string; network: string; idempotencyKey: string; reuseId?: string; createConfirmed: boolean } {
  if (!input || typeof input !== "object") fail("invalid_request", "A wallet preparation request is required.");
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  const network = typeof input.network === "string" ? input.network.trim().toLowerCase() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const reuseId = typeof input.reuseConfirmedWalletId === "string" ? input.reuseConfirmedWalletId.trim() : undefined;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || requestId.length > MAX_REQUEST_ID_LENGTH) fail("invalid_request", "A valid request ID is required.");
  if (!SUPPORTED_CHAIN_TYPES.has(network)) fail("invalid_request", "The wallet network is not supported by this bridge.");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(idempotencyKey) || idempotencyKey.length > MAX_IDEMPOTENCY_LENGTH) fail("invalid_request", "A valid idempotency key is required.");
  if (reuseId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(reuseId)) fail("invalid_request", "The confirmed wallet reference is invalid.");
  return {
    requestId,
    network,
    idempotencyKey,
    ...(reuseId ? { reuseId } : {}),
    createConfirmed: input.createWalletConfirmed === true || input.confirmed === true
  };
}

function validAddress(network: string, address: string): boolean {
  if (network === "ethereum") return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (network === "bitcoin-segwit") return /^(?:bc1q|tb1q)[a-z0-9]{20,90}$/.test(address);
  if (network === "bitcoin-taproot") return /^(?:bc1p|tb1p)[a-z0-9]{20,90}$/.test(address);
  return false;
}

function publicWallet(record: PrivyWalletRecord, network: string): PublicWallet {
  if (
    typeof record.id !== "string" || !record.id ||
    typeof record.address !== "string" || !validAddress(network, record.address) ||
    record.chain_type !== network ||
    (record.custody !== undefined && record.custody !== null)
  ) fail("provider_error", "Privy returned an incompatible wallet.", 502);
  return { id: record.id, address: record.address, network, ownership: "user_owned" };
}

function externalWalletId(userId: string, requestId: string, network: string): string {
  return `set-${crypto.createHash("sha256").update(`${userId}\0${requestId}\0${network}`).digest("hex").slice(0, 48)}`;
}

export type PrivyBridgeOptions = {
  appId: string;
  appSecret?: string;
  verificationKey?: PrivyVerificationKey;
  verifyAccessToken?: (token: string) => VerifiedPrivyAccessToken | Promise<VerifiedPrivyAccessToken>;
  api?: PrivyWalletApi;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
};

/**
 * Coordinates authentication and the user-owned wallet half of a purchase.
 * It deliberately stops before Stripe Onramp, payment, signing, swapping, or
 * any other transaction action.
 */
export class PrivyPurchaseBridge {
  private readonly options: PrivyBridgeOptions;
  private readonly api: PrivyWalletApi;
  private readonly operations = new Map<string, { fingerprint: string; result: WalletPreparationResult }>();
  private readonly inflight = new Map<string, { fingerprint: string; promise: Promise<WalletPreparationResult> }>();

  constructor(options: PrivyBridgeOptions) {
    if (options.appId !== PRIVY_APPROVED_APP_ID) fail("configuration_required", `Privy app must be the approved app ${PRIVY_APPROVED_APP_ID}.`, 503);
    if (!options.verifyAccessToken && !options.verificationKey) fail("configuration_required", "Privy JWT verification is not configured.", 503);
    if (!options.api && (!options.appSecret || !options.appSecret.trim())) fail("configuration_required", "Privy API credentials are not configured.", 503);
    this.options = options;
    this.api = options.api ?? new PrivyRestWalletApi({
      appId: options.appId,
      appSecret: options.appSecret as string,
      ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
      ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {})
    });
  }

  async authenticate(authorization: string | undefined): Promise<VerifiedPrivyAccessToken> {
    const token = extractPrivyBearerToken(authorization);
    try {
      const claims = this.options.verifyAccessToken
        ? await this.options.verifyAccessToken(token)
        : verifyPrivyAccessToken(token, this.options.verificationKey ? { verificationKey: this.options.verificationKey } : {});
      if (claims.appId !== PRIVY_APPROVED_APP_ID || claims.issuer !== "privy.io" || !claims.userId) {
        fail("invalid_token", "Privy access token is invalid.", 401);
      }
      return claims;
    } catch (error) {
      if (error instanceof PrivyBridgeError) throw error;
      fail("invalid_token", "Privy access token is invalid.", 401);
    }
  }

  async prepareWallet(input: WalletPreparationRequest): Promise<WalletPreparationResult> {
    const normalized = validateRequest(input);
    const claims = await this.authenticate(input.authorization);
    const fingerprint = JSON.stringify({ userId: claims.userId, requestId: normalized.requestId, network: normalized.network, reuseId: normalized.reuseId ?? null, createConfirmed: normalized.createConfirmed });
    const previous = this.operations.get(normalized.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("idempotency_conflict", "The idempotency key was already used for another wallet operation.", 409);
      return previous.result;
    }

    const pending = this.inflight.get(normalized.idempotencyKey);
    if (pending) {
      if (pending.fingerprint !== fingerprint) fail("idempotency_conflict", "The idempotency key was already used for another wallet operation.", 409);
      return pending.promise;
    }

    const promise = this.executeWallet(normalized, claims);
    this.inflight.set(normalized.idempotencyKey, { fingerprint, promise });
    try {
      const result = await promise;
      this.operations.set(normalized.idempotencyKey, { fingerprint, result });
      return result;
    } finally {
      if (this.inflight.get(normalized.idempotencyKey)?.promise === promise) this.inflight.delete(normalized.idempotencyKey);
    }
  }

  private async executeWallet(normalized: { requestId: string; network: string; idempotencyKey: string; reuseId?: string; createConfirmed: boolean }, claims: VerifiedPrivyAccessToken): Promise<WalletPreparationResult> {
    const wallets = await this.api.listUserWallets({ userId: claims.userId, chainType: normalized.network });
    const compatible = wallets.filter((wallet) => wallet.chain_type === normalized.network && (wallet.custody === undefined || wallet.custody === null));
    if (normalized.reuseId) {
      const selected = compatible.find((wallet) => wallet.id === normalized.reuseId);
      if (!selected) fail("invalid_request", "The confirmed wallet is not owned by this Privy user or is not compatible.", 403);
      const result: WalletPreparationResult = { status: "wallet_reused", privyUserId: claims.userId, wallet: publicWallet(selected, normalized.network) };
      return result;
    }
    if (compatible.length > 0) {
      const result: WalletPreparationResult = {
        status: "awaiting_wallet_confirmation",
        privyUserId: claims.userId,
        network: normalized.network,
        candidates: compatible.map((wallet) => publicWallet(wallet, normalized.network))
      };
      return result;
    }
    if (!normalized.createConfirmed) {
      const result: WalletPreparationResult = { status: "awaiting_wallet_creation_confirmation", privyUserId: claims.userId, network: normalized.network, candidates: [] };
      return result;
    }
    const created = await this.api.createUserWallet({ userId: claims.userId, chainType: normalized.network, externalId: externalWalletId(claims.userId, normalized.requestId, normalized.network), idempotencyKey: normalized.idempotencyKey });
    const result: WalletPreparationResult = { status: "wallet_created", privyUserId: claims.userId, wallet: publicWallet(created, normalized.network) };
    return result;
  }
}

type PrivyRestWalletApiOptions = { appId: string; appSecret: string; apiBaseUrl?: string; fetchImplementation?: typeof fetch };

class PrivyRestWalletApi implements PrivyWalletApi {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly authorization: string;
  private readonly appId: string;

  constructor(options: PrivyRestWalletApiOptions) {
    const baseUrl = new URL(options.apiBaseUrl ?? PRIVY_DEFAULT_API_BASE_URL);
    if (baseUrl.protocol !== "https:") fail("configuration_required", "Privy API must use HTTPS.", 503);
    this.baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.authorization = `Basic ${Buffer.from(`${options.appId}:${options.appSecret}`, "utf8").toString("base64")}`;
    this.appId = options.appId;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: this.authorization, "privy-app-id": this.appId, "Content-Type": "application/json", ...(init.headers ?? {}) }
      });
    } catch {
      fail("provider_error", "Privy wallet service could not be reached.", 502);
    }
    if (!response.ok) fail("provider_error", "Privy wallet service rejected the request.", 502);
    try {
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid response");
      return data as Record<string, unknown>;
    } catch {
      fail("provider_error", "Privy returned an invalid wallet response.", 502);
    }
  }

  async listUserWallets(input: { userId: string; chainType: string }): Promise<readonly PrivyWalletRecord[]> {
    const result: PrivyWalletRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ user_id: input.userId, chain_type: input.chainType, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const data = await this.request(`/v1/wallets?${params.toString()}`);
      if (!Array.isArray(data.data)) fail("provider_error", "Privy returned an invalid wallet list.", 502);
      result.push(...data.data as PrivyWalletRecord[]);
      if (typeof data.next_cursor !== "string" || !data.next_cursor) return result;
      cursor = data.next_cursor;
    }
    fail("provider_error", "Privy returned too many wallet pages.", 502);
  }

  async createUserWallet(input: { userId: string; chainType: string; externalId: string; idempotencyKey: string }): Promise<PrivyWalletRecord> {
    const data = await this.request("/v1/wallets", {
      method: "POST",
      headers: { "privy-idempotency-key": input.idempotencyKey },
      body: JSON.stringify({ chain_type: input.chainType, owner: { user_id: input.userId }, external_id: input.externalId })
    });
    return data as PrivyWalletRecord;
  }
}

export const createPrivyPurchaseBridge = (options: PrivyBridgeOptions): PrivyPurchaseBridge => new PrivyPurchaseBridge(options);
