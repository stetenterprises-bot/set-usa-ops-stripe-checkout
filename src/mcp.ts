import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as z from "zod/v4";
import {
  PRIVY_API_BASE_URL,
  PRIVY_BASE_CHAIN_ID,
  type RuntimeConfig
} from "./config.js";

const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/, "Use a non-negative decimal string.");

export function createSetCommerceMcpServer(config: RuntimeConfig): McpServer {
  const server = new McpServer(
    { name: "set-agentic-commerce", version: "0.1.0" },
    {
      instructions:
        "Use readiness tools before proposing wallet or payment activity. These tools never create wallets, Onramp sessions, payments, approvals, signatures, swaps, or provider resources. Treat every execution step as separately authorization-gated."
    }
  );

  server.registerTool(
    "get_commerce_readiness",
    {
      title: "Get SET commerce readiness",
      description:
        "Use this when a user or agent needs the current non-secret readiness state for SET MPP and the approved Privy wallet/onramp integration.",
      inputSchema: {},
      outputSchema: {
        service: z.string(),
        mode: z.enum(["test", "live"]),
        mpp: z.object({
          configured: z.boolean(),
          endpoint: z.string().url(),
          discovery: z.string().url(),
          amount: z.string(),
          currency: z.string()
        }),
        privy: z.object({
          configured: z.boolean(),
          approvedAppId: z.string(),
          apiBaseUrl: z.string().url(),
          defaultChain: z.string(),
          chainId: z.number().int()
        }),
        executionAuthorized: z.literal(false)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const baseUrl = config.applicationBaseUrl.replace(/\/$/, "");
      const result = {
        service: "SET Agentic Commerce",
        mode: config.stripeMode ?? "test",
        mpp: {
          configured: Boolean(config.stripeApiKey && config.stripeProfileId),
          endpoint: `${baseUrl}/paid`,
          discovery: `${baseUrl}/openapi.json`,
          amount: "0.50",
          currency: "usd"
        },
        privy: {
          configured: Boolean(config.privyAppId && config.privyAppSecret),
          approvedAppId: config.privyAppId ?? "unconfigured",
          apiBaseUrl: PRIVY_API_BASE_URL,
          defaultChain: "base",
          chainId: PRIVY_BASE_CHAIN_ID
        },
        executionAuthorized: false as const
      };

      return {
        structuredContent: result,
        content: [{ type: "text", text: "Returned non-secret SET commerce readiness. No execution was authorized." }]
      };
    }
  );

  server.registerTool(
    "prepare_crypto_acquisition",
    {
      title: "Prepare a crypto acquisition request",
      description:
        "Use this when a user has supplied the asset, network, crypto amount, fiat budget, and post-purchase intent and needs a normalized review packet before any wallet or Stripe Onramp action.",
      inputSchema: {
        requestId: z.string().min(8).max(128),
        destinationAsset: z.string().min(2).max(20),
        destinationNetwork: z.string().min(2).max(32),
        destinationAmount: decimalString,
        sourceCurrency: z.string().length(3),
        sourceBudget: decimalString,
        postPurchaseIntent: z.enum(["none", "swap", "dex", "dapp", "other"])
      },
      outputSchema: {
        requestId: z.string(),
        destinationAsset: z.string(),
        destinationNetwork: z.string(),
        destinationAmount: z.string(),
        sourceCurrency: z.string(),
        sourceBudget: z.string(),
        postPurchaseIntent: z.string(),
        approvalState: z.literal("intake"),
        executionAuthorized: z.literal(false),
        nextGate: z.string()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const result = {
        requestId: input.requestId,
        destinationAsset: input.destinationAsset.trim().toLowerCase(),
        destinationNetwork: input.destinationNetwork.trim().toLowerCase(),
        destinationAmount: input.destinationAmount,
        sourceCurrency: input.sourceCurrency.trim().toLowerCase(),
        sourceBudget: input.sourceBudget,
        postPurchaseIntent: input.postPurchaseIntent,
        approvalState: "intake" as const,
        executionAuthorized: false as const,
        nextGate: "Verify current quote and asset/network support, then obtain explicit confirmation before wallet or Onramp session creation."
      };

      return {
        structuredContent: result,
        content: [{ type: "text", text: "Prepared an intake-only acquisition packet. No wallet, payment, or transaction was created." }]
      };
    }
  );

  return server;
}

function methodNotAllowed(response: Response): void {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
}

export function registerMcpRoutes(app: Express, config: RuntimeConfig): void {
  app.post("/mcp", async (request: Request, response: Response) => {
    const server = createSetCommerceMcpServer(config);
    const transport = new StreamableHTTPServerTransport();

    try {
      // SDK 1.30's Node transport is structurally compatible at runtime, while its
      // optional callback declarations conflict with exactOptionalPropertyTypes.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error." },
          id: null
        });
      }
    }
  });

  app.get("/mcp", (_request, response) => methodNotAllowed(response));
  app.delete("/mcp", (_request, response) => methodNotAllowed(response));
}
