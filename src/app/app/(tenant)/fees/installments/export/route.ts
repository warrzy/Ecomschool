import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  buildInstallmentsExport,
  INSTALLMENTS_HEADERS,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/fees/installments/export?format=csv|xlsx&year=<requis>
 *   &classroom&student&status&from&to
 * Créances et échéances — finance.reports.read uniquement.
 * status ∈ UPCOMING|PARTIAL|PAID|LATE|CANCELLED (statut calculé).
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

  const status = ["UPCOMING", "PARTIAL", "PAID", "LATE", "CANCELLED"].includes(
    p("status") ?? "",
  )
    ? p("status")
    : undefined;
  const date = (k: string) => {
    const v = p(k);
    return v && !Number.isNaN(new Date(v).getTime())
      ? new Date(v)
      : undefined;
  };

  const { rows, truncated } = await buildInstallmentsExport(ctx, {
    academicYearId: yearId,
    classroomId: p("classroom"),
    studentId: p("student"),
    status,
    from: date("from"),
    to: date("to"),
  });
  if (truncated) {
    return new NextResponse(
      "Export trop volumineux — réduisez les filtres ou la période, puis réessayez.",
      { status: 413 },
    );
  }

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "echeances",
    sheets: [{ name: "Échéances", headers: INSTALLMENTS_HEADERS, rows }],
  });
}
