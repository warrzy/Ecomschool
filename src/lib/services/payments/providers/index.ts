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

export type {
  PaymentProviderAdapter,
  ProviderCapabilities,
  ProviderRefundInput,
  ProviderRefundResult,
  ProviderSettlementReport,
  SandboxScript,
  StatusResult,
} from "./types";
export {
  ADAPTER_CALL_TIMEOUT_MS,
  ProviderBusinessError,
  ProviderConfigError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "./types";
export { resolveProviderSecret } from "./secrets";
export function listProviderAdapters(): readonly PaymentProviderAdapter[] {
  return [...adapters.values()];
}
