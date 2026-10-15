import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  ANNUAL_HEADERS,
  RESULTS_SUBJECT_HEADERS,
  RESULTS_SUMMARY_HEADERS,
  buildAnnualResultsExport,
  buildPeriodResultsExport,
} from "@/lib/export/results";
import { toCsv } from "@/lib/export/csv";
import { buildXlsxBuffer } from "@/lib/export/xlsx";

/**
 * GET /app/results/export?format=csv|xlsx&period=<id>&classroom=<id>
 *   ou &year=<id>[&classroom=<id>]
 * Export des moyennes et résultats ENREGISTRÉS (aucun recalcul) :
 * - période + classe → synthèse + moyennes par matière ;
 * - année [+ classe] → résultats annuels.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("results.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const asTeacher = !(await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "assessments.manage",
  }));

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;
  const format = p("format") === "xlsx" ? "xlsx" : "csv";
  const periodId = p("period");
  const yearId = p("year");
  const classroomId = p("classroom");
  const stamp = new Date().toISOString().slice(0, 10);

  if (periodId) {
    if (!classroomId) {
      return new NextResponse("Paramètre classroom requis pour une période.", {
        status: 400,
      });
    }
    const res = await buildPeriodResultsExport(
      ctx,
      { academicPeriodId: periodId, classroomId },
      { asTeacher },
    );
    if (!res.ok) {
      return new NextResponse("Accès refusé : hors de votre périmètre.", {
        status: 403,
      });
    }
    const { summary, subjects } = res.result;
    if (format === "xlsx") {
      const buf = await buildXlsxBuffer([
        {
          name: "Synthèse",
          columns: RESULTS_SUMMARY_HEADERS.map((h) => ({ header: h, width: 18 })),
          rows: summary,
        },
        {
          name: "Par matière",
          columns: RESULTS_SUBJECT_HEADERS.map((h) => ({
            header: h,
            width: h === "appreciation" ? 30 : 16,
          })),
          rows: subjects,
        },
      ]);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="moyennes-${stamp}.xlsx"`,
        },
      });
    }
    // CSV : format long élève × matière (la synthèse reste lisible dans les
    // colonnes dédiées du fichier XLSX ; ici une ligne synthétique par élève
    // serait redondante — on exporte le détail).
    return new NextResponse(toCsv([...RESULTS_SUBJECT_HEADERS], subjects), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="moyennes-${stamp}.csv"`,
      },
    });
  }

  if (!yearId) {
    return new NextResponse("Paramètre year ou period requis.", { status: 400 });
  }
  const res = await buildAnnualResultsExport(
    ctx,
    { academicYearId: yearId, classroomId },
    { asTeacher },
  );
  if (!res.ok) {
    return new NextResponse("Accès refusé : hors de votre périmètre.", {
      status: 403,
    });
  }
  const rows = res.result;
  if (format === "xlsx") {
    const buf = await buildXlsxBuffer([
      {
        name: "Résultats annuels",
        columns: ANNUAL_HEADERS.map((h) => ({ header: h, width: 18 })),
        rows,
      },
    ]);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="resultats-annuels-${stamp}.xlsx"`,
      },
    });
  }
  return new NextResponse(toCsv([...ANNUAL_HEADERS], rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="resultats-annuels-${stamp}.csv"`,
    },
  });
}
