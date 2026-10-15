import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  buildClassesExport,
  CLASSES_HEADERS,
  LEVELS_HEADERS,
} from "@/lib/export/classes";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/classrooms/export?format=csv|xlsx&year&level&status
 * Classes (effectifs réels) + synthèse par niveau en XLSX.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("classroom.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const status = ["ACTIVE", "ARCHIVED"].includes(p("status") ?? "")
    ? p("status")
    : undefined;
  const { classes, levels } = await buildClassesExport(ctx, {
    academicYearId: p("year"),
    levelId: p("level"),
    status,
  });

  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "classes",
    sheets: [
      { name: "Classes", headers: CLASSES_HEADERS, rows: classes },
      { name: "Niveaux", headers: LEVELS_HEADERS, rows: levels },
    ],
  });
}
