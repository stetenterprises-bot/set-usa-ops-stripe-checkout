import { describe, expect, it } from "vitest";
import { preflightPublicOnrampGeography } from "../src/onramp-eligibility.js";

describe("public Onramp geography preflight", () => {
  it("accepts a US state while preserving a provider-authoritative boundary", () => {
    expect(preflightPublicOnrampGeography("us-il")).toEqual({
      eligible: true,
      normalizedGeography: "US-IL",
      basis: "stripe_public_embedded_onramp_docs_2026-08-31"
    });
  });

  it("rejects Hawaii, territories, and unsupported countries", () => {
    expect(preflightPublicOnrampGeography("US-HI")).toMatchObject({ eligible: false, code: "unsupported_geography" });
    expect(preflightPublicOnrampGeography("US-PR")).toMatchObject({ eligible: false, code: "unsupported_geography" });
    expect(preflightPublicOnrampGeography("CA")).toMatchObject({ eligible: false, code: "unsupported_geography" });
  });
});
