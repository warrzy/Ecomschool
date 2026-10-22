/**
 * Registre des adaptateurs prestataires. Les adaptateurs réels
 * (Orange Money, Moov Money, agrégateur) s'enregistreront ici en G3-E.
 */
import { sandboxAdapter } from "./sandbox";
import type { PaymentProviderAdapter } from "./types";

const adapters = new Map<string, PaymentProviderAdapter>([
  [sandboxAdapter.code, sandboxAdapter],
]);

export function getProviderAdapter(code: string): PaymentProviderAdapter | null {
  return adapters.get(code) ?? null;
}

export type { PaymentProviderAdapter, SandboxScript, StatusResult } from "./types";
export { ProviderTimeoutError } from "./types";
