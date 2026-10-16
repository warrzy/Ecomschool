import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  buildUnpaidExport,
  UNPAID_HEADERS,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/fees/unpaid/export?format=csv|xlsx&year=<requis>
 *   &classroom&student&late=1
 * Impayés et retards — finance.reports.read uniquement.
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

  const { rows, truncated } = await buildUnpaidExport(ctx, {
    academicYearId: yearId,
    classroomId: p("classroom"),
    studentId: p("student"),
    lateOnly: p("late") === "1",
  });

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "impayes",
    sheets: [{ name: "Impayés", headers: UNPAID_HEADERS, rows }],
    truncated,
  });
}
