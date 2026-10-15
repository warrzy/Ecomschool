import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { buildStaffExport, STAFF_HEADERS } from "@/lib/export/teachers";
import { exportFile } from "@/lib/export/respond";

/**
 * GET /app/users/export?format=csv|xlsx
 * Personnel : comptes et rôles de l'établissement (user.read).
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("user.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const { rows } = await buildStaffExport(ctx);
  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: "personnel",
    sheets: [{ name: "Personnel", headers: STAFF_HEADERS, rows }],
  });
}
