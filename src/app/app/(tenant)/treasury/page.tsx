import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  getTreasuryDashboard,
  TREASURY_METHOD_LABELS,
} from "@/lib/services/finance/treasury";
import { DashCard, EmptyState, KpiCard, StatusBadge } from "@/components/ui/dash";
import { BarList, Donut, FlowBars } from "@/components/ui/charts";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fmtShort = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)} k`
      : `${n}`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);

const ICONS = {
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M16 12a2 2 0 0 0 0 4h4v-4Z",
  card: "M2 7h20v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z M2 7V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2 M2 10h20",
  chart: "M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3",
  ops: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
};

export default async function TreasuryPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("treasury.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true, startDate: true, endDate: true },
  });

  const preset = str("preset") ?? "";
  const yearId = str("year") ?? "";
  const method = str("method") ?? "";
  const fromStr = str("from") ?? "";
  const toStr = str("to") ?? "";

  // Résolution de la période — explicite, documentée :
  //   preset=month → mois civil courant ; preset=year → année civile ;
  //   from/to      → période personnalisée (borne `to` inclusive) ;
  //   year         → bornes de l'année scolaire choisie (si aucun preset/from/to) ;
  //   défaut       → mois civil courant.
  const now = new Date();
  let from: Date;
  let to: Date;
  let periodLabel: string;
  const selectedYear = years.find((y) => y.id === yearId);
  if (preset === "year") {
    from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    periodLabel = `Année ${now.getUTCFullYear()}`;
  } else if (fromStr || toStr) {
    from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : new Date(0);
    to = toStr ? new Date(`${toStr}T00:00:00Z`) : new Date();
    if (toStr) to = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    periodLabel = `${fromStr || "…"} → ${toStr || "…"}`;
  } else if (preset === "schoolyear" && selectedYear) {
    from = selectedYear.startDate;
    to = selectedYear.endDate;
    periodLabel = `Année scolaire ${selectedYear.name}`;
  } else {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    periodLabel = from.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  const dash = await getTreasuryDashboard(c, {
    from,
    to,
    academicYearId: selectedYear?.id,
    method:
      method && method in TREASURY_METHOD_LABELS
        ? (method as keyof typeof TREASURY_METHOD_LABELS)
        : undefined,
  });

  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <h1 className="text-xl font-display font-bold tracking-tight text-ink">
          Trésorerie
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {periodLabel} — solde net des flux enregistrés : indicateur calculé à
          partir des opérations retenues, pas un solde de caisse certifié.
        </p>
        <form method="GET" className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Période
            <select aria-label="Période" name="preset" defaultValue={preset} className={`ml-2 ${input}`}>
              <option value="">Mois courant</option>
              <option value="year">Année civile courante</option>
              <option value="schoolyear">Année scolaire sélectionnée</option>
            </select>
          </label>
          <label className="block text-sm">
            Du
            <input aria-label="Date de début" name="from" type="date" defaultValue={fromStr} className={`ml-2 ${input}`} />
          </label>
          <label className="block text-sm">
            Au
            <input aria-label="Date de fin" name="to" type="date" defaultValue={toStr} className={`ml-2 ${input}`} />
          </label>
          <label className="block text-sm">
            Année scolaire
            <select aria-label="Année scolaire" name="year" defaultValue={yearId} className={`ml-2 ${input}`}>
              <option value="">Toutes</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}{y.isCurrent ? " (en cours)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Mode de paiement
            <select aria-label="Mode de paiement" name="method" defaultValue={method} className={`ml-2 ${input}`}>
              <option value="">Tous</option>
              {Object.entries(TREASURY_METHOD_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Filtrer
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          Les dates « Du / Au » priment sur les presets quand elles sont
          renseignées. L&apos;année scolaire filtre les flux rattachés ; les
          dépenses non rattachées restent visibles ci-dessous.
        </p>
      </div>

      {selectedYear && dash.unlinkedDisbursed > 0 ? (
        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {fmt(dash.unlinkedDisbursed)} de dépenses décaissées non rattachées à
          l&apos;année {selectedYear.name} sont exclues des totaux ci-dessous —
          elles restent comptabilisées en trésorerie sur la période.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Encaissements validés"
          value={fmt(dash.collectedTotal)}
          hint={`${dash.collectedCount} encaissement${dash.collectedCount > 1 ? "s" : ""} validé${dash.collectedCount > 1 ? "s" : ""} sur la période`}
          icon={ICONS.wallet}
          tone="leaf"
        />
        <KpiCard
          label="Dépenses décaissées"
          value={fmt(dash.disbursedTotal)}
          hint={`${dash.disbursedCount} décaissement${dash.disbursedCount > 1 ? "s" : ""} réel${dash.disbursedCount > 1 ? "s" : ""}`}
          icon={ICONS.card}
          tone="coral"
        />
        <KpiCard
          label="Solde net des flux"
          value={fmt(dash.net)}
          hint="Validés − décaissés — indicateur calculé, pas un solde de caisse"
          icon={ICONS.chart}
          tone={dash.net >= 0 ? "brand" : "sun"}
        />
        <KpiCard
          label="Paiements annulés"
          value={`${dash.cancelledPaymentsCount}`}
          hint={
            dash.cancelledPaymentsCount > 0
              ? `${fmt(dash.cancelledPaymentsTotal)} exclus des entrées`
              : "Aucun sur la période"
          }
          icon={ICONS.ops}
          tone="mist"
        />
      </div>

      <p className="text-xs text-zinc-500">
        Un paiement annulé est une correction administrative motivée (erreur de
        saisie, doublon…) : il n&apos;est pas compté dans les encaissements et
        ne correspond pas nécessairement à un remboursement réel — aucune
        écriture de remboursement n&apos;est enregistrée dans le système. Une
        dépense annulée après paiement reste comptée en sortie : l&apos;argent
        décaissé l&apos;a effectivement été.
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        <DashCard
          title="Entrées / sorties mensuelles"
          sub={periodLabel}
          className="lg:col-span-3"
        >
          {dash.months.length ? (
            <FlowBars
              items={dash.months.map((m) => ({
                label: m.label,
                collected: m.collected,
                disbursed: m.disbursed,
              }))}
              format={fmtShort}
            />
          ) : (
            <EmptyState message="Aucune période à afficher." />
          )}
        </DashCard>
        <DashCard
          title="Dépenses par catégorie"
          sub="Montants décaissés sur la période"
          className="lg:col-span-2"
        >
          {dash.expensesByCategory.length ? (
            <Donut items={dash.expensesByCategory} />
          ) : (
            <EmptyState message="Aucune dépense décaissée sur la période." />
          )}
        </DashCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <DashCard
          title="Dernières opérations"
          sub="10 derniers mouvements de flux"
          className="lg:col-span-3"
        >
          {dash.recent.length ? (
            <div className="overflow-x-auto">
              <table aria-label="Dernières opérations" className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                    <th scope="col" className="py-2">Date</th>
                    <th scope="col" className="py-2">Opération</th>
                    <th scope="col" className="py-2">Mode</th>
                    <th scope="col" className="py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.recent.map((op, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 text-zinc-600">{dstr(op.date)}</td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <StatusBadge
                            label={op.kind === "IN" ? "Entrée" : "Sortie"}
                            tone={op.kind === "IN" ? "green" : "red"}
                          />
                          <span>
                            {op.label}
                            {op.detail ? (
                              <span className="text-zinc-500"> — {op.detail}</span>
                            ) : null}
                          </span>
                        </span>
                        {op.cancelledAfterPayment ? (
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Annulée après paiement — décaissement conservé.
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 text-zinc-600">
                        {op.method ? TREASURY_METHOD_LABELS[op.method] : "—"}
                      </td>
                      <td className={`py-2 text-right font-medium ${op.kind === "IN" ? "text-emerald-700" : "text-red-700"}`}>
                        {op.kind === "IN" ? "+" : "−"}{fmt(op.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              message="Aucune opération sur la période."
              hint="Les encaissements validés et dépenses décaissées apparaîtront ici."
            />
          )}
        </DashCard>
        <DashCard
          title="Encaissements par mode"
          sub="Montants validés sur la période"
          className="lg:col-span-2"
        >
          {dash.collectedByMethod.length ? (
            <BarList items={dash.collectedByMethod} unit="FCFA" />
          ) : (
            <EmptyState message="Aucun encaissement sur la période." />
          )}
        </DashCard>
      </div>
    </div>
  );
}
