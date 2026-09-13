import { describe, expect, it } from "vitest";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { createWalletExportRecipient } from "../src/wallet-client/hpke.js";

describe("browser-only wallet recovery encryption", () => {
  it("decrypts Privy's SPKI/P-256 suite and rejects a different recipient or modified ciphertext", async () => {
    const recipient = await createWalletExportRecipient();
    const publicKey = await crypto.subtle.importKey("spki", Buffer.from(recipient.recipientPublicKey, "base64"), { name: "ECDH", namedCurve: "P-256" }, true, []);
    const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
    const sender = await suite.createSenderContext({ recipientPublicKey: publicKey });
    const ciphertext = new Uint8Array(await sender.seal(new TextEncoder().encode("synthetic-test-key-only")));
    const enc = Buffer.from(sender.enc).toString("base64");
    expect(await recipient.decrypt(enc, Buffer.from(ciphertext).toString("base64"))).toBe("synthetic-test-key-only");
    const other = await createWalletExportRecipient();
    await expect(other.decrypt(enc, Buffer.from(ciphertext).toString("base64"))).rejects.toThrow();
    ciphertext[0] = ciphertext[0]! ^ 1;
    await expect(recipient.decrypt(enc, Buffer.from(ciphertext).toString("base64"))).rejects.toThrow();
  });
});
