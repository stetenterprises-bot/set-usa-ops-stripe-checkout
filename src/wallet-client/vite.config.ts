import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "/wallet-assets/",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../../public/wallet-assets"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "wallet.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
