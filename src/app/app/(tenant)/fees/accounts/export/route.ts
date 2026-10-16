import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  ACCOUNTS_HEADERS,
  buildAccountsExport,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/fees/accounts/export?format=csv|xlsx&year=<requis>&classroom&student
 * Situation financière par élève — finance.reports.read uniquement.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const yearId = p("year");
  if (!yearId) {
    return new NextResponse("Paramètre year requis (année scolaire).", {
      status: 400,
    });
  }
  const year = await prisma.academicYear.findFirst({
    where: { id: yearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) {
    return new NextResponse("Année scolaire invalide.", { status: 400 });
  }

  const { rows, truncated } = await buildAccountsExport(ctx, {
    academicYearId: yearId,
    classroomId: p("classroom"),
    studentId: p("student"),
  });
  if (truncated) {
    return new NextResponse(
      "Export trop volumineux — réduisez les filtres ou la période, puis réessayez.",
      { status: 413 },
    );
  }

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "comptes-eleves",
    sheets: [{ name: "Comptes", headers: ACCOUNTS_HEADERS, rows }],
  });
}
