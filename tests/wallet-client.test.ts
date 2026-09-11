import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerWalletClientRoutes } from "../src/wallet-client-routes.js";

describe("customer wallet delivery", () => {
  it("exposes only public configuration and disables configuration caching", async () => {
    const app = express();
    registerWalletClientRoutes(app, { port: 4242, applicationBaseUrl: "http://localhost:4242", privyAppId: "public-app", stripePublishableKey: "pk_test_public", privyAppSecret: "private-secret" });
    const response = await request(app).get("/wallet/config");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ privyAppId: "public-app", stripePublishableKey: "pk_test_public" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("serves the generated entry with resolvable script and stylesheet URLs", async () => {
    const app = express();
    registerWalletClientRoutes(app, { port: 4242, applicationBaseUrl: "http://localhost:4242" });
    const redirect = await request(app).get("/wallet");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe("https://ledgerline-compliance.sthomas935.chatgpt.site/wallet");
    const response = await request(app).get("/wallet/application");
    expect(response.status).toBe(200);
    const assets = [...response.text.matchAll(/(?:src|href)="(\/wallet-assets\/[^"<>]+)"/g)].map((match) => match[1]!);
    expect(assets.some((asset) => asset.endsWith(".css"))).toBe(true);
    expect(assets.some((asset) => asset.endsWith(".js"))).toBe(true);
    for (const asset of assets) {
      const result = await request(app).get(asset);
      expect(result.status, asset).toBe(200);
    }
    expect((await request(app).get("/wallet-assets/wallet.js")).headers["cache-control"]).toBe("no-cache");
    expect((await request(app).get("/wallet/config")).status).toBe(503);
  });
});
