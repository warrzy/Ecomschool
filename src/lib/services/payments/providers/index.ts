/**
 * Registre des adaptateurs prestataires. PAYDUNYA est enregistré
 * mais inerte : le verrou global MOBILE_MONEY_LIVE_ENABLED +
 * `liveEnabled` + secrets valides restent requis avant le moindre
 * appel transport (checkLiveExecution dans les services).
 */
import { paydunyaAdapter } from "./paydunya";
import { sandboxAdapter } from "./sandbox";
import type { PaymentProviderAdapter } from "./types";

const adapters = new Map<string, PaymentProviderAdapter>([
  [sandboxAdapter.code, sandboxAdapter],
  [paydunyaAdapter.code, paydunyaAdapter],
]);

export function getProviderAdapter(code: string): PaymentProviderAdapter | null {
  return adapters.get(code) ?? null;
}

/**
 * Enregistre un adaptateur à chaud — point d'entrée des futurs
 * adaptateurs réels et des faux adaptateurs de recette (mémoire
 * seule, sans effet hors processus).
 */
export function registerProviderAdapter(adapter: PaymentProviderAdapter): void {
  adapters.set(adapter.code, adapter);
}

export type {
  AdapterCallContext,
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
export type { RemoteEnv } from "./secrets";
export {
  checkLiveExecution,
  checkRemoteExecution,
  isLivePaymentsEnabled,
  isRemoteTestEnabled,
} from "./live";
export type { LiveProviderShape } from "./live";
export function listProviderAdapters(): readonly PaymentProviderAdapter[] {
  return [...adapters.values()];
}
