const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"
]);

const US_STATES_AND_DC = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY"
]);

export type PublicOnrampEligibility =
  | { eligible: true; normalizedGeography: string; basis: "stripe_public_embedded_onramp_docs_2026-08-31" }
  | { eligible: false; normalizedGeography: string | null; code: "unsupported_geography" | "invalid_geography"; reason: string };

/**
 * Public-document preflight only. Account approval, identity, payment method,
 * pair, amount, and provider risk decisions remain authoritative at Stripe.
 */
export function preflightPublicOnrampGeography(value: string): PublicOnrampEligibility {
  const geography = value.trim().toUpperCase().replace(/_/g, "-");
  if (!/^[A-Z]{2}(?:-[A-Z0-9]{2,3})?$/.test(geography)) {
    return { eligible: false, normalizedGeography: null, code: "invalid_geography", reason: "Use an ISO country code and region when applicable, such as US-IL." };
  }
  const [country, region] = geography.split("-");
  if (country === "US") {
    if (!region) return { eligible: false, normalizedGeography: geography, code: "invalid_geography", reason: "A US state or District of Columbia code is required for Onramp preflight." };
    if (region === "HI") return { eligible: false, normalizedGeography: geography, code: "unsupported_geography", reason: "Stripe's public Embedded Onramp documentation excludes Hawaii." };
    if (!US_STATES_AND_DC.has(region)) return { eligible: false, normalizedGeography: geography, code: "unsupported_geography", reason: "The supplied region is not one of the documented eligible US states or the District of Columbia." };
    return { eligible: true, normalizedGeography: geography, basis: "stripe_public_embedded_onramp_docs_2026-08-31" };
  }
  if (country && EU_COUNTRIES.has(country)) {
    return { eligible: true, normalizedGeography: country, basis: "stripe_public_embedded_onramp_docs_2026-08-31" };
  }
  return { eligible: false, normalizedGeography: geography, code: "unsupported_geography", reason: "The geography is outside the public Embedded Onramp US/EU availability stated by Stripe." };
}
