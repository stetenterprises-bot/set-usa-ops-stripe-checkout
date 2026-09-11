import express, { type Express, type Request, type Response } from "express";
import { join } from "node:path";
import type { RuntimeConfig } from "./config.js";

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "no-store");
}

/**
 * Registers the customer-owned wallet client without coupling the client
 * entrypoint to the main app module.  The browser receives only public
 * configuration; provider secrets remain server-side.
 */
export function registerWalletClientRoutes(app: Express, config: RuntimeConfig): void {
  const publicDirectory = join(process.cwd(), "public");
  const walletAssetsDirectory = join(publicDirectory, "wallet-assets");

  app.get("/wallet", (_request: Request, response: Response) => {
    noStore(response);
    return response.sendFile(join(walletAssetsDirectory, "index.html"));
  });

  app.get("/wallet/config", (_request: Request, response: Response) => {
    noStore(response);
    if (!config.privyAppId || !config.stripePublishableKey) {
      return response.status(503).json({
        error: "The customer wallet client is not fully configured.",
        code: "configuration_required"
      });
    }
    return response.json({
      privyAppId: config.privyAppId,
      stripePublishableKey: config.stripePublishableKey
    });
  });

  app.use(
    "/wallet-assets",
    express.static(walletAssetsDirectory, {
      index: false,
      fallthrough: false,
      setHeaders: (response, filePath) => {
        // The entry file is intentionally stable so wallet.html does not need
        // a release manifest. Hashed chunks/assets may be cached forever.
        const isEntry = filePath.endsWith("\\wallet.js") || filePath.endsWith("/wallet.js") || filePath.endsWith("\\index.html") || filePath.endsWith("/index.html");
        response.setHeader("Cache-Control", isEntry ? "no-cache" : "public, max-age=31536000, immutable");
      }
    })
  );
}
