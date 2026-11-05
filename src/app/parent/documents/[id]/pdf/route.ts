import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { getAdminDocForParent } from "@/lib/services/administrative-docs";
import { adminDocFileName, buildAdminDocPdf } from "@/lib/pdf/build-admin-doc";

/** PDF d'un document administratif ISSUED — parent rattaché à l'élève. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("portal.parent");
  const { id } = await props.params;

  const doc = await getAdminDocForParent(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  // 404 uniforme : document absent, révoqué ou autre élève — pas de
  // fuite d'existence ni d'état.
  if (!doc) return new NextResponse("Document introuvable", { status: 404 });

  const pdf = await buildAdminDocPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${adminDocFileName(doc)}"`,
    },
  });
}
