import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  buildStudentsExport,
  STUDENTS_FULL_HEADERS,
  STUDENTS_STD_HEADERS,
} from "@/lib/export/students";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/students/export?format=csv|xlsx&year&classroom&status&full=1
 * Standard (student.read) : données pédagogiques minimales.
 * full=1 (student.manage) : fiche administrative complète.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("student.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const full = p("full") === "1";
  if (
    full &&
    !(await userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "student.manage",
    }))
  ) {
    return new Response("Accès refusé : export complet réservé.", {
      status: 403,
    });
  }

  const status = ["ACTIVE", "ARCHIVED"].includes(p("status") ?? "")
    ? p("status")
    : undefined;
  const { rows, truncated } = await buildStudentsExport(
    ctx,
    {
      academicYearId: p("year"),
      classroomId: p("classroom"),
      status,
    },
    { full },
  );

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: full ? "eleves-complet" : "eleves",
    sheets: [
      {
        name: "Élèves",
        headers: full ? STUDENTS_FULL_HEADERS : STUDENTS_STD_HEADERS,
        rows,
      },
    ],
    truncated,
  });
}
