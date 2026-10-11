import { requireSchoolPermission } from "@/lib/permissions/guard";
import { exportStudentsCsv } from "@/lib/services/students";

export async function GET() {
  const tenant = await requireSchoolPermission("student.read");
  const csv = await exportStudentsCsv({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eleves.csv"',
    },
  });
}
