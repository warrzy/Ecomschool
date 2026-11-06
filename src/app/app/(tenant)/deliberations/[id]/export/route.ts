import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { getSessionForPv } from "@/lib/services/deliberations";
import { toCsv } from "@/lib/export/csv";

/** Liste des décisions de la session (CSV) — agents habilités. */
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

  const headers = [
    "matricule",
    "eleve",
    "moyenne",
    "rang",
    "mention",
    "proposition",
    "decision_retenue",
    "statut",
    "motif_ajustement",
  ];
  const rows = data.session.decisions.map((d) => [
    d.student.matricule,
    `${d.student.lastName} ${d.student.firstName}`,
    d.averageSnapshot ?? "",
    d.rankSnapshot ?? "",
    d.mentionSnapshot ?? "",
    d.proposedLabel ?? "",
    d.finalLabel ?? "",
    d.status,
    d.adjustmentReason ?? "",
  ]);
  return new NextResponse(toCsv([...headers], rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="decisions-${data.session.number}.csv"`,
    },
  });
}
