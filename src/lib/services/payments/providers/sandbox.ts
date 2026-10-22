/**
 * Adaptateur SANDBOX — simulateur déterministe de prestataire Mobile
 * Money. Aucun appel réseau, aucun argent réel, aucun secret requis.
 * Couvre : succès, échec, expiration, réponse tardive, réponse
 * répétée, timeout. La concurrence de confirmation est garantie par
 * le verrou applicatif (service), pas par l'adaptateur.
 */
import type {
  InitiateInput,
  InitiateResult,
  PaymentProviderAdapter,
  SandboxScript,
  StatusResult,
} from "./types";
import { ProviderTimeoutError } from "./types";

function txId(providerRef: string) {
  return `SBTX-${providerRef}`;
}

export const sandboxAdapter: PaymentProviderAdapter = {
  code: "SANDBOX",

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const script = input.sandboxScript;
    if (script?.outcome === "TIMEOUT" && (script.checks ?? 0) === 0) {
      throw new ProviderTimeoutError("Simulation : timeout à l'initiation");
    }
    return {
      providerRef: `SB-${input.intentId}`,
      instructions: `Simulation : composez *144# pour valider ${input.amount} ${input.currency} (aucun débit réel).`,
    };
  },

  async checkStatus(providerRef: string, script?: SandboxScript | null): Promise<StatusResult> {
    const outcome = script?.outcome ?? "PENDING";
    switch (outcome) {
      case "SUCCESS":
      case "REPEATED":
        return { status: "SUCCESS", providerTxId: txId(providerRef), rawStatus: "200" };
      case "FAILED":
        return {
          status: "FAILED",
          providerTxId: txId(providerRef),
          rawStatus: "FAILED",
          reason: script?.reason ?? "Solde insuffisant (simulation)",
        };
      case "TIMEOUT":
        throw new ProviderTimeoutError("Simulation : timeout à la consultation");
      case "LATE": {
        const checks = script?.checks ?? 0;
        const after = script?.afterChecks ?? 2;
        // Reste PENDING pendant `after` consultations, puis succès.
        if (checks > after) {
          return { status: "SUCCESS", providerTxId: txId(providerRef), rawStatus: "200" };
        }
        return { status: "PENDING", rawStatus: "PROCESSING" };
      }
      case "PENDING":
      default:
        return { status: "PENDING", rawStatus: "PROCESSING" };
    }
  },
};
