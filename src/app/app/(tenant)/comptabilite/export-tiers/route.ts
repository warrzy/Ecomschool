import { requireSchoolPermission } from "@/lib/permissions/guard";
import { agingCsv } from "@/lib/services/accounting/thirdparty";

/** CG-2 : export CSV de la balance âgée des créances élèves. */
export async function GET() {
  const t = await requireSchoolPermission("accounting.export");
  const r = await agingCsv({ userId: t.userId, schoolId: t.schoolId });
  if (!r.ok) return new Response(r.error, { status: 400 });
  return new Response(r.result, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="balance-agee.csv"',
    },
  });
}
