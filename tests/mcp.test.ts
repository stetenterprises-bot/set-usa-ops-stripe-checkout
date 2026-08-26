import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createSetCommerceMcpServer } from "../src/mcp.js";

describe("SET commerce MCP server", () => {
  it("exposes only read-only, non-executing tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createSetCommerceMcpServer({
      port: 4242,
      stripeMode: "live",
      stripeApiKey: ["rk", "live", "example"].join("_"),
      stripeProfileId: "profile_example",
      applicationBaseUrl: "https://set.example"
    });
    const client = new Client({ name: "set-mcp-test", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "get_commerce_readiness",
      "prepare_crypto_acquisition"
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const readiness = await client.callTool({ name: "get_commerce_readiness", arguments: {} });
    expect(readiness.structuredContent).toMatchObject({
      mode: "live",
      mpp: { configured: true },
      privy: { configured: false },
      executionAuthorized: false
    });

    const intake = await client.callTool({
      name: "prepare_crypto_acquisition",
      arguments: {
        requestId: "request-1234",
        destinationAsset: "USDC",
        destinationNetwork: "Base",
        destinationAmount: "25.00",
        sourceCurrency: "USD",
        sourceBudget: "25.00",
        postPurchaseIntent: "none"
      }
    });
    expect(intake.structuredContent).toMatchObject({
      destinationAsset: "usdc",
      destinationNetwork: "base",
      approvalState: "intake",
      executionAuthorized: false
    });

    await client.close();
    await server.close();
  });
});
