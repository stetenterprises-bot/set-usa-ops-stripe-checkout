import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StripeResourceStore } from "./stripe-integration.js";

export function createJsonResourceStore(path: string): StripeResourceStore {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as Awaited<ReturnType<StripeResourceStore["read"]>>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
    },
    async write(resources) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(resources, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  };
}

