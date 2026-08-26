import { useCallback, useEffect, useState } from "react";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { fetchStripeSignature } from "@stripe/ui-extension-sdk/utils";
import { Badge, Box, Button, ContextView } from "@stripe/ui-extension-sdk/ui";
import {
  isCommerceReadiness,
  readinessGates,
  type CommerceReadiness
} from "../lib/readiness";

const READINESS_ENDPOINT = "https://set-business-consults-mpp.onrender.com/stripe-app/readiness";

export default function App({ userContext }: ExtensionContextValue) {
  const [readiness, setReadiness] = useState<CommerceReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    const userId = userContext?.id;
    const accountId = userContext?.account.id;
    if (!userId || !accountId) {
      setError("Stripe user context is unavailable.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(READINESS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": await fetchStripeSignature()
        },
        body: JSON.stringify({ user_id: userId, account_id: accountId })
      });
      const body: unknown = await response.json();
      if (!response.ok || !isCommerceReadiness(body)) {
        throw new Error("SET readiness data is unavailable.");
      }
      setReadiness(body);
    } catch (requestError) {
      setReadiness(null);
      setError(requestError instanceof Error ? requestError.message : "SET readiness data is unavailable.");
    } finally {
      setPending(false);
    }
  }, [userContext?.account.id, userContext?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ContextView
      title="Agentic commerce readiness"
      description="SET-hosted MPP, checkout, Stripe event, and Privy activation gates."
      externalLink={{
        label: "Open SET service",
        href: "https://set-business-consults-mpp.onrender.com"
      }}
      actions={
        <Button type="secondary" pending={pending} onPress={() => void refresh()}>
          Refresh readiness
        </Button>
      }
    >
      <Box css={{ stack: "y", rowGap: "medium" }}>
        {readiness
          ? readinessGates(readiness).map((gate) => (
              <Box key={gate.label} css={{ stack: "x", columnGap: "medium", alignY: "center" }}>
                <Box css={{ width: "fill" }}>{gate.label}</Box>
                <Badge type={gate.ready ? "positive" : "warning"}>
                  {gate.ready ? "Ready" : "Action required"}
                </Badge>
              </Box>
            ))
          : null}
        {error ? <Box>{error}</Box> : null}
        <Box css={{ color: "secondary" }}>
          This drawer reports readiness only. It cannot authorize payments, wallets, swaps, or provider changes.
        </Box>
      </Box>
    </ContextView>
  );
}
