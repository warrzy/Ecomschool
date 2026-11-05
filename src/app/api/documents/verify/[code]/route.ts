import { NextRequest, NextResponse } from "next/server";
import { verifyPublicDocument } from "@/lib/services/administrative-docs";

/**
 * Vérification publique d'un document administratif par code opaque —
 * sans session. Réponse minimale : statut + champs imprimés sur le
 * document (comparaison papier). Aucun identifiant interne.
 */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ code: string }> },
) {
  const { code } = await props.params;
  const v = await verifyPublicDocument(code);
  return NextResponse.json(v, {
    status: v.status === "UNKNOWN" ? 404 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
