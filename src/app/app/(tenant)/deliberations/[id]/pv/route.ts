import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { getSessionForPv } from "@/lib/services/deliberations";
import {
  buildDeliberationPvPdf,
  deliberationPvFileName,
} from "@/lib/pdf/deliberation";

/** PV de délibération — agents habilités uniquement. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("deliberations.read");
  const { id } = await props.params;

  const data = await getSessionForPv(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!data) return new NextResponse("Session introuvable", { status: 404 });

  const pdf = await buildDeliberationPvPdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${deliberationPvFileName(data.session.number)}"`,
    },
  });
}
