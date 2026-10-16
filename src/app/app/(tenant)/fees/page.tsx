import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { financeDashboard } from "@/lib/services/finance/payments";
import { ensureDefaultFeeCategories } from "@/lib/services/finance/fees";
import { generateChargesAction } from "@/app/app/(tenant)/fees/actions";
import { errorMessage } from "@/lib/ui/errorLabels";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

export default async function FeesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");

  const [canManage, canConfigure, canReadReports] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.fees.manage" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.configure" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.reports.read" }),
  ]);

  await ensureDefaultFeeCategories(c);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId = str("year") ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id;
  const dash = yearId ? await financeDashboard(c, { academicYearId: yearId }) : null;

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId: tenant.schoolId, academicYearId: yearId ?? "" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const card = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
  const kpi = (label: string, value: string) => (
    <div className={card}>
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">Finances</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Tableau de bord financier
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/app/fees/accounts" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">
              Comptes élèves
            </Link>
            {canReadReports ? (
              <>
                <Link href={`/app/fees/payments?year=${yearId ?? ""}`} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">
                  Journal des paiements
                </Link>
                <Link href={`/app/fees/unpaid?year=${yearId ?? ""}`} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">
                  Impayés
                </Link>
              </>
            ) : null}
            {canConfigure ? (
              <Link href="/app/fees/settings" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">
                Configuration
              </Link>
            ) : null}
          </div>
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "charges" ? `Créances générées (${sp.count ?? 0}).` : ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "CLOSED_DAY" ? "Journée de caisse clôturée." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select name="year" defaultValue={yearId ?? ""} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
          {canManage && yearId ? (
            <>
              <select form="gen-charges" name="classroomId" defaultValue="" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
                <option value="">Toutes les classes</option>
                {classrooms.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name}</option>
                ))}
              </select>
              <button
                type="submit"
                form="gen-charges"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Générer les créances
              </button>
            </>
          ) : null}
        </form>
        {canManage && yearId ? (
          <form id="gen-charges" action={generateChargesAction}>
            <input type="hidden" name="academicYearId" value={yearId} />
          </form>
        ) : null}
      </div>

      {dash ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpi("Total facturé", fmt(dash.totalCharges))}
            {kpi("Réductions", fmt(dash.discounts))}
            {kpi("Encaissé", fmt(dash.paid))}
            {kpi("Solde restant", fmt(dash.balance))}
            {kpi("Encaissé aujourd'hui", fmt(dash.paidToday))}
            {kpi("Encaissé ce mois", fmt(dash.paidThisMonth))}
            {kpi("Échéances en retard", `${dash.lateCount} (${fmt(dash.lateAmount)})`)}
            {kpi("Montant exigible", fmt(dash.due))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <div className="mb-3 text-sm font-medium text-zinc-900">Par catégorie</div>
              <table className="w-full text-left text-sm">
                <tbody>
                  {dash.byCategory.map((r) => (
                    <tr key={r.label} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2">{r.label}</td>
                      <td className="py-2 text-right font-medium">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  {dash.byCategory.length === 0 ? (
                    <tr><td className="py-2 text-zinc-500">Aucune créance.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className={card}>
              <div className="mb-3 text-sm font-medium text-zinc-900">Par mode de paiement</div>
              <table className="w-full text-left text-sm">
                <tbody>
                  {dash.byMethod.map((r) => (
                    <tr key={r.method} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2">{METHOD_LABELS[r.method] ?? r.method}</td>
                      <td className="py-2 text-right font-medium">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  {dash.byMethod.length === 0 ? (
                    <tr><td className="py-2 text-zinc-500">Aucun encaissement.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className={card}>Aucune année scolaire.</div>
      )}
    </div>
  );
}
