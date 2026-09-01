import type { Express, Request, Response } from "express";
import {
  asPurchasingError,
  type CustomerPurchasingOrchestrator
} from "./purchasing-orchestrator.js";

function unavailable(response: Response): Response {
  return response.status(503).json({
    error: "The durable Stripe-Privy purchasing bridge is not fully configured.",
    code: "configuration_required"
  });
}

function fail(response: Response, cause: unknown): Response {
  const issue = asPurchasingError(cause);
  return response.status(issue.status).json({ error: issue.message, code: issue.code });
}

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "no-store");
}

function routeRequestId(request: Request): string | null {
  const value = request.params.requestId;
  return typeof value === "string" ? value : null;
}

export function registerPurchasingRoutes(
  app: Express,
  orchestrator: CustomerPurchasingOrchestrator | undefined
): void {
  app.post("/purchasing/requests", async (request, response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    try {
      const purchase = await orchestrator.createRequest(request.body, request.header("authorization"));
      return response.status(201).json({ purchase, executionAuthorized: false, nextGate: "wallet_selection_or_creation" });
    } catch (cause) {
      return fail(response, cause);
    }
  });

  app.get("/purchasing/requests/:requestId", async (request, response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    const requestId = routeRequestId(request);
    if (!requestId) return response.status(400).json({ error: "A valid purchase request ID is required.", code: "invalid_request" });
    try {
      return response.json({ purchase: await orchestrator.getStatus(requestId, request.header("authorization")) });
    } catch (cause) {
      return fail(response, cause);
    }
  });

  app.post("/purchasing/requests/:requestId/wallet", async (request, response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    const requestId = routeRequestId(request);
    if (!requestId) return response.status(400).json({ error: "A valid purchase request ID is required.", code: "invalid_request" });
    try {
      const idempotencyKey = request.header("idempotency-key");
      if (!idempotencyKey) return response.status(400).json({ error: "Idempotency-Key is required.", code: "invalid_request" });
      const result = await orchestrator.prepareWallet({
        requestId,
        authorization: request.header("authorization"),
        idempotencyKey,
        ...(typeof request.body?.walletChainType === "string" ? { walletChainType: request.body.walletChainType } : {}),
        ...(typeof request.body?.reuseConfirmedWalletId === "string" ? { reuseConfirmedWalletId: request.body.reuseConfirmedWalletId } : {}),
        ...(request.body?.createWalletConfirmed === true ? { createWalletConfirmed: true } : {})
      });
      return response.status(result.result.status === "wallet_created" ? 201 : 200).json({
        ...result,
        executionAuthorized: false,
        nextGate: result.purchase.state === "awaiting_wallet_confirmation" ? "wallet_confirmation" : "wallet_selection_or_creation_confirmation"
      });
    } catch (cause) {
      return fail(response, cause);
    }
  });

  app.post("/purchasing/requests/:requestId/wallet/confirm", async (request, response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    const requestId = routeRequestId(request);
    if (!requestId) return response.status(400).json({ error: "A valid purchase request ID is required.", code: "invalid_request" });
    try {
      const idempotencyKey = request.header("idempotency-key");
      if (!idempotencyKey || typeof request.body?.walletId !== "string") {
        return response.status(400).json({ error: "Wallet ID and Idempotency-Key are required.", code: "invalid_request" });
      }
      const purchase = await orchestrator.confirmWallet({
        requestId,
        authorization: request.header("authorization"),
        walletId: request.body.walletId,
        idempotencyKey
      });
      return response.json({ purchase, executionAuthorized: false, nextGate: "quote_and_approval_review" });
    } catch (cause) {
      return fail(response, cause);
    }
  });

  app.post("/purchasing/requests/:requestId/quote", async (request, response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    const requestId = routeRequestId(request);
    if (!requestId) return response.status(400).json({ error: "A valid purchase request ID is required.", code: "invalid_request" });
    try {
      const result = await orchestrator.prepareQuoteAndApproval(requestId, request.header("authorization"));
      return response.json({ ...result, executionAuthorized: false, nextGate: "exact_purchase_approval" });
    } catch (cause) {
      return fail(response, cause);
    }
  });

  app.post("/purchasing/requests/:requestId/approve", async (request: Request, response: Response) => {
    noStore(response);
    if (!orchestrator) return unavailable(response);
    const requestId = routeRequestId(request);
    if (!requestId) return response.status(400).json({ error: "A valid purchase request ID is required.", code: "invalid_request" });
    if (request.body?.confirmed !== true) {
      return response.status(400).json({ error: "Confirm the exact quoted purchase before creating an Onramp session.", code: "confirmation_required" });
    }
    if (typeof request.body?.digest !== "string" || typeof request.body?.nonce !== "string") {
      return response.status(400).json({ error: "The approval digest and nonce are required.", code: "invalid_request" });
    }
    try {
      const result = await orchestrator.approveAndCreateSession({
        requestId,
        authorization: request.header("authorization"),
        digest: request.body.digest,
        nonce: request.body.nonce,
        ...(request.body?.budgetOverageConfirmed === true ? { budgetOverageConfirmed: true } : {}),
        ...(request.ip ? { customerIp: request.ip } : {})
      });
      return response.status(201).json({ ...result, executionAuthorized: true, nextGate: "customer_completes_stripe_payment_and_kyc" });
    } catch (cause) {
      return fail(response, cause);
    }
  });
}
