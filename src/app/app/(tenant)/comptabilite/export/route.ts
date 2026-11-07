import { requireSchoolPermission } from "@/lib/permissions/guard";
import { exportCsv } from "@/lib/services/accounting";

export async function GET(req: Request) {
  const t = await requireSchoolPermission("accounting.export");
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "journal";
  const exerciseId = url.searchParams.get("exercise") ?? "";
  if (!["journal", "ledger", "balance"].includes(kind) || !exerciseId) {
    return new Response("Paramètres invalides", { status: 400 });
  }
  const r = await exportCsv(
    { userId: t.userId, schoolId: t.schoolId },
    kind as "journal" | "ledger" | "balance",
    exerciseId,
    {
      journalId: url.searchParams.get("journal") ?? undefined,
      accountId: url.searchParams.get("account") ?? undefined,
      includeSimulation: url.searchParams.get("simulation") === "1",
    },
  );
  if (!r.ok) return new Response(r.error, { status: 400 });
  return new Response(`\uFEFF${r.result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.result.filename}"`,
    },
  });
}
