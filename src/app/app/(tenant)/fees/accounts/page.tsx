import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { listAccounts } from "@/lib/services/finance/accounts";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default async function AccountsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const canReport = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "finance.reports.read",
  });
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId = str("year") ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id;
  const classroomId = str("classroom");

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId: tenant.schoolId, ...(yearId ? { academicYearId: yearId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const accounts = yearId
    ? await listAccounts(c, { academicYearId: yearId, classroomId })
    : [];
  const withCharges = accounts.filter((a) => a.charges > 0 || a.paid > 0);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Comptes élèves
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Comptes financiers ({withCharges.length})
        </div>
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select name="year" defaultValue={yearId ?? ""} className={input}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select name="classroom" defaultValue={classroomId ?? ""} className={input}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
        </form>
        {canReport && yearId ? (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a href={`/app/fees/accounts/export?format=csv&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Comptes CSV
            </a>
            <a href={`/app/fees/accounts/export?format=xlsx&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Comptes Excel
            </a>
            <a href={`/app/fees/installments/export?format=csv&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Échéances CSV
            </a>
            <a href={`/app/fees/installments/export?format=xlsx&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Échéances Excel
            </a>
          </div>
        ) : null}
        {canReport ? (
          <p className="mt-2 text-xs text-zinc-500">
            Export « Échéances » : reste contractuel (montant − encaissements
            ventilés). Export « Impayés » : reste net après imputation des
            réductions (FIFO) — les deux montants peuvent donc différer pour
            un élève bénéficiant de remises.
          </p>
        ) : null}
      </div>

      <div className={card}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">Matricule</th>
              <th className="py-2">Élève</th>
              <th className="py-2">Classe</th>
              <th className="py-2 text-right">Facturé</th>
              <th className="py-2 text-right">Réductions</th>
              <th className="py-2 text-right">Payé</th>
              <th className="py-2 text-right">Solde</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {withCharges.map((a) => (
              <tr key={a.student.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">{a.student.matricule}</td>
                <td className="py-2">{a.student.firstName} {a.student.lastName}</td>
                <td className="py-2">{a.classroom.name}</td>
                <td className="py-2 text-right">{fmt(a.charges)}</td>
                <td className="py-2 text-right">{fmt(a.discounts)}</td>
                <td className="py-2 text-right">{fmt(a.paid)}</td>
                <td className={`py-2 text-right font-medium ${a.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {fmt(a.balance)}
                </td>
                <td className="py-2 text-right">
                  <Link href={`/app/fees/accounts/${a.student.id}?year=${yearId}`} className="text-xs text-zinc-700 underline">
                    Dossier
                  </Link>
                </td>
              </tr>
            ))}
            {withCharges.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-zinc-500">Aucune créance générée pour cette année.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
