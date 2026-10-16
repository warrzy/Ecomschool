import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  buildReportCardsExport,
  REGISTRY_HEADERS,
  VERSIONS_HEADERS,
} from "@/lib/export/reportcards";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/report-cards/export?format=csv|xlsx&year&period&classroom
 *   &student&status=DRAFT|CALCULATED|PENDING_VALIDATION|VALIDATED|PUBLISHED|RECTIFIED
 * Registre des bulletins — reportcards.read.
 * Sans reportcards.publish → périmètre enseignant : uniquement les
 * classes de ses affectations pour l'année du bulletin.
 * XLSX : feuille « Registre » + feuille « Versions ».
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("reportcards.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const asTeacher = !(await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "reportcards.publish",
  }));

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;
  const status = [
    "DRAFT",
    "CALCULATED",
    "PENDING_VALIDATION",
    "VALIDATED",
    "PUBLISHED",
    "RECTIFIED",
  ].includes(p("status") ?? "")
    ? p("status")
    : undefined;

  const res = await buildReportCardsExport(
    ctx,
    {
      academicYearId: p("year"),
      academicPeriodId: p("period"),
      classroomId: p("classroom"),
      studentId: p("student"),
      status,
    },
    { asTeacher },
  );
  if (!res.ok) {
    return new NextResponse("Accès refusé : hors de votre périmètre.", {
      status: 403,
    });
  }

  const { registry, versions, truncated } = res.result;
  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "registre-bulletins",
    sheets: [
      { name: "Registre", headers: REGISTRY_HEADERS, rows: registry },
      { name: "Versions", headers: VERSIONS_HEADERS, rows: versions },
    ],
    truncated,
  });
}
