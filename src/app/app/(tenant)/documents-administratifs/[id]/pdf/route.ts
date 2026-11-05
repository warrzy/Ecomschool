import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { getAdminDocForDownload } from "@/lib/services/administrative-docs";
import { adminDocFileName, buildAdminDocPdf } from "@/lib/pdf/build-admin-doc";

/** PDF d'un document administratif émis — agents habilités uniquement. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("administrative-docs.read");
  const { id } = await props.params;

  const doc = await getAdminDocForDownload(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!doc) return new NextResponse("Document introuvable", { status: 404 });

  const pdf = await buildAdminDocPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${adminDocFileName(doc)}"`,
    },
  });
}
