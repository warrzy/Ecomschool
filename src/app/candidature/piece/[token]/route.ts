import { NextRequest, NextResponse } from "next/server";
import { readApplicantDocumentByTicket } from "@/lib/services/admissions";

/**
 * GET /candidature/piece/[token] — téléchargement d'une pièce par le
 * déposant. Le ticket est un HMAC signé côté serveur (15 min, borné au
 * couple dossier/document) : aucun identifiant seul, aucun accessToken
 * brut et aucun chemin de stockage ne permet de lire un fichier.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/candidature/piece/[token]">,
) {
  const { token } = await ctx.params;
  const res = await readApplicantDocumentByTicket(token);
  if (!res.ok) {
    const status = res.error === "INTEGRITY_ERROR" ? 500 : 404;
    return new NextResponse("Document introuvable", { status });
  }
  const { doc, buffer } = res;
  const safeName = doc.originalName.replace(/[^\w. -]/g, "_").slice(0, 120);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
