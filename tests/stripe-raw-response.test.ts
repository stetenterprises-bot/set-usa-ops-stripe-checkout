import { describe, expect, it } from "vitest";
import { stripeRawResponseData } from "../src/stripe-raw-response.js";

describe("stripeRawResponseData", () => {
  it("accepts the direct object returned by stripe-node rawRequest", () => {
    const session = { id: "cos_live", client_secret: "secret", status: "initialized" };
    expect(stripeRawResponseData(session)).toBe(session);
  });

  it("retains compatibility with wrapped test clients", () => {
    const session = { id: "cos_test", client_secret: "secret", status: "initialized" };
    expect(stripeRawResponseData({ data: session })).toBe(session);
  });
});
