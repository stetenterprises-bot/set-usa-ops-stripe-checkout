import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

export type WalletExportRecipient = {
  recipientPublicKey: string;
  decrypt: (encapsulatedKey: string, ciphertext: string) => Promise<string>;
};

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  if (value.length > 32768 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error("Privy returned an invalid encrypted wallet export.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305()
  });
}

/**
 * Creates an in-memory HPKE recipient matching Privy's wallet export suite.
 * The private key remains in this closure and is never serialized or stored.
 */
export async function createWalletExportRecipient(): Promise<WalletExportRecipient> {
  const hpke = suite();
  const keyPair = await hpke.kem.generateKeyPair();
  // Privy's export API expects DER SubjectPublicKeyInfo, as used by its SDK.
  const serializedPublicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  return {
    recipientPublicKey: base64Encode(serializedPublicKey),
    decrypt: async (encapsulatedKey, ciphertext) => {
      const recipient = await hpke.createRecipientContext({
        recipientKey: keyPair.privateKey,
        enc: base64Decode(encapsulatedKey)
      });
      const plaintext = new Uint8Array(await recipient.open(base64Decode(ciphertext)));
      if (plaintext.length === 0) throw new Error("Privy returned an empty wallet export.");
      try { return new TextDecoder().decode(plaintext); }
      finally { plaintext.fill(0); }
    }
  };
}
