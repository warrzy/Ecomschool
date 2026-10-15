import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  ASSIGNMENTS_HEADERS,
  buildTeachersExport,
  TEACHERS_FULL_HEADERS,
  TEACHERS_STD_HEADERS,
} from "@/lib/export/teachers";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/teachers/export?format=csv|xlsx&year&status&full=1
 * Standard (teacher.read) : identité + affectations.
 * full=1 (teacher.manage) : ajoute email/téléphone.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("teacher.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const full = p("full") === "1";
  if (
    full &&
    !(await userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "teacher.manage",
    }))
  ) {
    return new Response("Accès refusé : export complet réservé.", {
      status: 403,
    });
  }

  const status = ["ACTIVE", "ARCHIVED"].includes(p("status") ?? "")
    ? p("status")
    : undefined;
  const { teachers, assignments } = await buildTeachersExport(
    ctx,
    { academicYearId: p("year"), status },
    { full },
  );

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: full ? "enseignants-complet" : "enseignants",
    sheets: [
      {
        name: "Enseignants",
        headers: full ? TEACHERS_FULL_HEADERS : TEACHERS_STD_HEADERS,
        rows: teachers,
      },
      {
        name: "Affectations",
        headers: ASSIGNMENTS_HEADERS,
        rows: assignments,
      },
    ],
  });
}
