import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { readDocument } from "@/lib/services/documents";

/**
 * GET /app/documents/[id]/download — seule voie d'accès aux fichiers.
 * Revérifie à chaque téléchargement : session, école, rôle, lien objet,
 * statut ACTIVE, intégrité SHA-256. Toujours servi en `attachment`
 * (jamais de rendu inline → pas d'exécution de contenu).
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/app/documents/[id]/download">,
) {
  const tenant = await requireSchoolPermission("documents.read");
  const { id } = await ctx.params;

  const res = await readDocument(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!res.ok) {
    const status = res.error === "INTEGRITY_ERROR" ? 500 : 404;
    return new NextResponse("Document introuvable", { status });
  }

  const { doc, buffer } = res.result;
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
