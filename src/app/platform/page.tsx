import Link from "next/link";
import { requirePlatformContext } from "@/lib/tenant/context";
import { getPlatformPermissionKeys } from "@/lib/permissions/rbac";
import { platformDashboard } from "@/lib/services/platform/dashboard";
import {
  DashCard,
  EmptyState,
  KpiCard,
  StatusBadge,
} from "@/components/ui/dash";
import { BarList, Donut, TrendBars } from "@/components/ui/charts";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fmtShort = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)} k`
      : `${n}`;

const I = {
  building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18 M2 22h20 M6 12h4v4H6z M14 6h4v4h-4z",
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4Z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M16 13H8 M16 17H8",
  chart: "M3 3v18h18 M8 17V9 M13 17V5 M18 17v-7",
};

const SUB_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "zinc" | "brand" }> = {
  TRIALING: { label: "Essai", tone: "amber" },
  ACTIVE: { label: "Actif", tone: "green" },
  PAST_DUE: { label: "Impayé", tone: "red" },
  GRACE: { label: "Grâce", tone: "amber" },
  SUSPENDED: { label: "Suspendu", tone: "red" },
  EXPIRED: { label: "Expiré", tone: "zinc" },
};

export default async function PlatformDashboard() {
  const ctx = await requirePlatformContext();
  const [perms, d] = await Promise.all([
    getPlatformPermissionKeys(ctx.userId),
    platformDashboard(),
  ]);
  const canSchools = perms.has("platform.schools.read") || perms.has("platform.schools.manage");
  const canSubs = perms.has("platform.subscriptions.read");
  const canInvoices = perms.has("platform.invoices.read");
  const canManageSchools = perms.has("platform.schools.manage");

  return (
    <div className="space-y-5">
      {/* Bandeau */}
      <div className="rounded-2xl bg-brand-950 p-6 text-white shadow-soft">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-300">
          ECOM-TOUCH · Pilotage
        </div>
        <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">
          Tableau de bord plateforme
        </h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/platform/schools" className="rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-white/20">
            Établissements
          </Link>
          <Link href="/platform/plans" className="rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-white/20">
            Offres
          </Link>
          <Link href="/platform/subscriptions" className="rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-white/20">
            Abonnements
          </Link>
          <Link href="/platform/invoices" className="rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-white/20">
            Factures
          </Link>
        </div>
      </div>

      {/* Alertes prioritaires */}
      {(canManageSchools && d.pendingSignupRequests > 0) || d.pendingRequests > 0 ? (
        <DashCard title="Actions prioritaires" className="border-sun-300 bg-butter">
          <ul className="space-y-2 text-sm">
            {canManageSchools && d.pendingSignupRequests > 0 ? (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-800">
                  {d.pendingSignupRequests} demande(s) d&apos;inscription en attente
                </span>
                <Link
                  href="/platform/signup-requests"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Traiter
                </Link>
              </li>
            ) : null}
            {d.pendingRequests > 0 ? (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-800">
                  {d.pendingRequests} demande(s) de changement d&apos;offre
                </span>
                <Link
                  href="/platform/subscriptions"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-white"
                >
                  Voir
                </Link>
              </li>
            ) : null}
          </ul>
        </DashCard>
      ) : null}

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canSchools ? (
          <>
            <KpiCard label="Établissements" value={`${d.activeSchools}/${d.totalSchools}`} hint="actifs / total" icon={I.building} tone="brand" href="/platform/schools" />
            <KpiCard label="En essai" value={d.trialing} icon={I.refresh} tone="sun" />
          </>
        ) : null}
        {canSubs ? (
          <>
            <KpiCard label="Abonnements actifs" value={d.active} icon={I.refresh} tone="leaf" href="/platform/subscriptions" />
            <KpiCard label="Suspendus / expirés" value={`${d.suspended} / ${d.expired}`} icon={I.alert} tone="coral" />
          </>
        ) : null}
        {canInvoices ? (
          <>
            <KpiCard label="CA facturé" value={fmt(d.invoicedTotal)} icon={I.file} tone="brand" href="/platform/invoices" />
            <KpiCard label="Encaissé" value={fmt(d.collectedTotal)} hint={`dont ${fmt(d.collectedThisMonth)} ce mois`} icon={I.wallet} tone="leaf" />
            <KpiCard label="Impayés SaaS" value={fmt(d.unpaidTotal)} hint={`${d.unpaidCount} facture(s)`} icon={I.alert} tone="coral" />
            <KpiCard label="MRR estimé" value={fmt(d.mrr)} hint="revenus mensuels récurrents" icon={I.chart} tone="mist" />
          </>
        ) : null}
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-2">
        {canSubs ? (
          <DashCard title="Abonnements par statut" sub="Répartition actuelle">
            {d.trialing + d.active + d.pastDue + d.grace + d.suspended + d.expired > 0 ? (
              <Donut
                items={[
                  { label: "Actifs", value: d.active },
                  { label: "Essai", value: d.trialing },
                  { label: "Impayés", value: d.pastDue },
                  { label: "Grâce", value: d.grace },
                  { label: "Suspendus", value: d.suspended },
                  { label: "Expirés", value: d.expired },
                ].filter((i) => i.value > 0)}
                centerLabel={`${d.active + d.trialing}`}
              />
            ) : (
              <EmptyState message="Aucun abonnement enregistré." />
            )}
          </DashCard>
        ) : null}
        {canSubs ? (
          <DashCard title="Répartition par offre" action={{ href: "/platform/plans", label: "Offres" }}>
            {d.byPlan.length > 0 ? (
              <BarList items={d.byPlan.map((p) => ({ label: p.plan, value: p.count }))} unit="abonnement(s)" />
            ) : (
              <EmptyState message="Aucun abonnement." />
            )}
          </DashCard>
        ) : null}
        {canInvoices ? (
          <DashCard title="Encaissements mensuels" sub="6 derniers mois · paiements validés">
            {d.collectedByMonth.some((m) => m.value > 0) ? (
              <TrendBars items={d.collectedByMonth} format={fmtShort} tone="leaf" />
            ) : (
              <EmptyState message="Aucun encaissement sur la période." />
            )}
          </DashCard>
        ) : null}
        {canSchools ? (
          <DashCard title="Nouveaux établissements" sub="6 derniers mois">
            {d.schoolsByMonth.some((m) => m.value > 0) ? (
              <TrendBars items={d.schoolsByMonth} />
            ) : (
              <EmptyState message="Aucun nouvel établissement sur la période." />
            )}
          </DashCard>
        ) : null}
      </div>

      {/* Échéances */}
      {canSubs ? (
        <DashCard
          title="Échéances sous 30 jours"
          sub="Renouvellements à anticiper"
          action={{ href: "/platform/subscriptions", label: "Abonnements" }}
        >
          {d.renewals.length === 0 ? (
            <EmptyState message="Aucune échéance proche." />
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="Échéances sous 30 jours" className="w-full text-left text-sm">
                <tbody>
                  {d.renewals.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2.5 font-medium text-ink">{r.school.name}</td>
                      <td className="py-2.5 text-zinc-600">{r.plan.name}</td>
                      <td className="py-2.5 text-right">
                        <span className="text-xs text-zinc-500">
                          {r.currentPeriodEnd.toISOString().slice(0, 10)}
                        </span>{" "}
                        <StatusBadge
                          label={SUB_STATUS[r.status]?.label ?? r.status}
                          tone={SUB_STATUS[r.status]?.tone ?? "zinc"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashCard>
      ) : null}
    </div>
  );
}
