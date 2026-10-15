import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  buildEnrollmentsExport,
  ENROLLMENTS_HEADERS,
} from "@/lib/export/students";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/enrollments/export?format=csv|xlsx&year&classroom&status
 * Inscriptions avec historique par année scolaire.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("enrollment.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const status = ["ENROLLED", "TRANSFERRED", "WITHDRAWN", "COMPLETED"].includes(
    p("status") ?? "",
  )
    ? p("status")
    : undefined;
  const { rows, truncated } = await buildEnrollmentsExport(ctx, {
    academicYearId: p("year"),
    classroomId: p("classroom"),
    status,
  });

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "inscriptions",
    sheets: [{ name: "Inscriptions", headers: ENROLLMENTS_HEADERS, rows }],
    truncated,
  });
}
