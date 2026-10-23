import { NextResponse } from "next/server";
import { receiveWebhook } from "@/lib/services/payments/webhooks";

/**
 * G3-B — Réception des webhooks prestataires Mobile Money.
 * URL : POST /api/webhooks/mobile-money/{providerId}
 * Le providerId (cuid) résout fournisseur ET école côté serveur —
 * aucune confiance dans un identifiant d'école présent dans le corps.
 *
 * Politique d'accusé :
 *   202 — événement authentifié, enregistré et enfilé pour traitement
 *         asynchrone (idempotent, dédupliqué par externalId).
 *   401 — signature invalide ou expirée (rien n'est persisté).
 *   404 — fournisseur inconnu/inactif (réponse uniforme, pas d'oracle).
 *   413 — corps > 16 Ko.
 *   503 — secret non configuré côté serveur.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await ctx.params;
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const res = await receiveWebhook({ providerId, rawBody, headers });
  if (!res.ok) {
    const status =
      res.error === "NOT_FOUND" ? 404
      : res.error === "PAYLOAD_TOO_LARGE" ? 413
      : res.error === "PROVIDER_NOT_CONFIGURED" ? 503
      : res.error === "EXPIRED" || res.error === "INVALID_SIGNATURE" ? 401
      : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json(
    { received: true, duplicate: res.data.duplicate },
    { status: 202 },
  );
}
