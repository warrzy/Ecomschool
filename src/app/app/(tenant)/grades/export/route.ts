import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { buildGradesExport, GRADES_HEADERS } from "@/lib/export/grades";
import { toCsv } from "@/lib/export/csv";
import { buildXlsxBuffer } from "@/lib/export/xlsx";

/**
 * GET /app/grades/export?format=csv|xlsx&year&period&classroom&subject
 *   &teacher&assessment=<id>
 * Export détaillé des notes. Périmètre enseignant strict appliqué
 * côté serveur lorsque l'utilisateur n'a pas assessments.manage.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("grades.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const asTeacher = !(await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "assessments.manage",
  }));

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;
  const format = p("format") === "xlsx" ? "xlsx" : "csv";

  const res = await buildGradesExport(
    ctx,
    {
      academicYearId: p("year"),
      academicPeriodId: p("period"),
      classroomId: p("classroom"),
      subjectId: p("subject"),
      teacherId: p("teacher"),
      assessmentId: p("assessment"),
    },
    { asTeacher },
  );
  if (!res.ok) {
    return new NextResponse("Accès refusé : hors de votre périmètre.", {
      status: 403,
    });
  }

  const { rows, truncated } = res.result;
  if (truncated) {
    rows.push(["Export tronqué — affinez les filtres (plafond atteint)."]);
  }
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const buf = await buildXlsxBuffer([
      {
        name: "Notes",
        columns: GRADES_HEADERS.map((h) => ({
          header: h,
          width: h === "observation" ? 30 : h === "evaluation" ? 26 : 14,
        })),
        rows,
      },
    ]);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="notes-${stamp}.xlsx"`,
      },
    });
  }

  return new NextResponse(toCsv([...GRADES_HEADERS], rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="notes-${stamp}.csv"`,
    },
  });
}
