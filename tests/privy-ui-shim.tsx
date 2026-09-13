import type { ReactNode } from "react";

export function PrivyProvider({ children }: { appId: string; config?: unknown; children: ReactNode }) {
  return children;
}

export function usePrivy() {
  return {
    ready: true,
    authenticated: true,
    login: () => undefined,
    logout: () => undefined,
    getAccessToken: async () => "simulated-access-token"
  };
}
