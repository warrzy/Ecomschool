import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { readDocument } from "@/lib/services/documents";

/**
 * GET /app/admissions/pieces/[id]/download — téléchargement d'une pièce
 * de candidature par le personnel habilité. `admissions.review` est
 * exigé : `documents.read`/`documents.manage` seuls ne suffisent pas
 * (canReadDocument applique la porte dédiée aux ownerType=ADMISSION).
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/app/admissions/pieces/[id]/download">,
) {
  const tenant = await requireSchoolPermission("admissions.review");
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
