import Link from "next/link";
import { requirePlatformContext } from "@/lib/tenant/context";
import { platformDashboard } from "@/lib/services/platform/dashboard";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default async function PlatformDashboard() {
  await requirePlatformContext();
  const d = await platformDashboard();

  const card = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
  const kpi = (label: string, value: string | number, sub?: string) => (
    <div className={card} key={label}>
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">ECOM-TOUCH</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Tableau de bord plateforme
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/platform/schools" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">Établissements</Link>
            <Link href="/platform/plans" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">Offres</Link>
            <Link href="/platform/subscriptions" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">Abonnements</Link>
            <Link href="/platform/invoices" className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50">Factures</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi("Établissements", `${d.activeSchools}/${d.totalSchools}`, "actifs / total")}
        {kpi("En essai", d.trialing)}
        {kpi("Abonnements actifs", d.active)}
        {kpi("Suspendus / expirés", `${d.suspended} / ${d.expired}`)}
        {kpi("CA facturé", fmt(d.invoicedTotal))}
        {kpi("Encaissé", fmt(d.collectedTotal), `dont ${fmt(d.collectedThisMonth)} ce mois`)}
        {kpi("Impayés SaaS", fmt(d.unpaidTotal), `${d.unpaidCount} factures`)}
        {kpi("MRR estimé", fmt(d.mrr), "revenus mensuels récurrents")}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Répartition par offre</div>
          <table className="w-full text-left text-sm">
            <tbody>
              {d.byPlan.map((p) => (
                <tr key={p.plan} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{p.plan}</td>
                  <td className="py-2 text-right font-medium">{p.count}</td>
                </tr>
              ))}
              {d.byPlan.length === 0 ? (
                <tr><td className="py-2 text-zinc-500">Aucun abonnement.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-900">Échéances sous 30 jours</div>
            {d.pendingRequests > 0 ? (
              <Link href="/platform/subscriptions" className="text-xs text-amber-700 underline">
                {d.pendingRequests} demande(s) d&apos;offre
              </Link>
            ) : null}
          </div>
          <table className="w-full text-left text-sm">
            <tbody>
              {d.renewals.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{r.school.name}</td>
                  <td className="py-2">{r.plan.name}</td>
                  <td className="py-2 text-right text-xs">
                    {r.currentPeriodEnd.toISOString().slice(0, 10)}
                    <span className={`ml-2 ${r.status === "TRIALING" ? "text-amber-700" : "text-zinc-500"}`}>
                      {r.status === "TRIALING" ? "essai" : r.status.toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {d.renewals.length === 0 ? (
                <tr><td colSpan={3} className="py-2 text-zinc-500">Aucune échéance proche.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
