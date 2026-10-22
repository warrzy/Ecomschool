import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  buildReport,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/services/finance/reports";
import { listExpenseCategories } from "@/lib/services/finance/expenses";
import { TREASURY_METHOD_LABELS } from "@/lib/services/finance/treasury";
import { DashCard, EmptyState, KpiCard } from "@/components/ui/dash";
import type { ExpenseStatus, PaymentMethod } from "@prisma/client";

export const instant = false;

const PREVIEW_ROWS = 50;

export default async function FinanceReportsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;

  const [years, categories] = await Promise.all([
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true, startDate: true, endDate: true },
    }),
    listExpenseCategories(c),
  ]);

  const type = (REPORT_TYPES.some((t) => t.value === str("type"))
    ? str("type")
    : "payments") as ReportType;
  const preset = str("preset") ?? "";
  const yearId = str("year") ?? "";
  const method = str("method") ?? "";
  const categoryId = str("category") ?? "";
  const status = str("status") ?? "";
  const fromStr = str("from") ?? "";
  const toStr = str("to") ?? "";

  // Même résolution de période que /app/treasury — montants identiques
  // garantis à filtres identiques.
  const now = new Date();
  let from: Date | undefined;
  let to: Date | undefined;
  const selectedYear = years.find((y) => y.id === yearId);
  if (preset === "year") {
    from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  } else if (fromStr || toStr) {
    from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : undefined;
    to = toStr ? new Date(`${toStr}T00:00:00Z`) : undefined;
  } else if (preset === "schoolyear" && selectedYear) {
    from = selectedYear.startDate;
    to = selectedYear.endDate;
  } else {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  const toExclusive = toStr && to
    ? new Date(to.getTime() + 24 * 60 * 60 * 1000)
    : to;

  const report = await buildReport(c, type, {
    from,
    to: toExclusive,
    academicYearId: selectedYear?.id,
    method:
      method && method in TREASURY_METHOD_LABELS
        ? (method as PaymentMethod)
        : undefined,
    categoryId: categoryId || undefined,
    status:
      status === "DRAFT" || status === "PAID" || status === "CANCELLED"
        ? (status as ExpenseStatus)
        : undefined,
  });

  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";
  // Dates résolues → bornes inclusives dans les paramètres d'export
  // (la route reconstruit la borne exclusive).
  const exportQs = [
    `type=${type}`,
    from ? `from=${from.toISOString().slice(0, 10)}` : "",
    toExclusive ? `to=${new Date(toExclusive.getTime() - 1).toISOString().slice(0, 10)}` : "",
    yearId ? `year=${yearId}` : "",
    method ? `method=${method}` : "",
    categoryId ? `category=${categoryId}` : "",
    status ? `status=${status}` : "",
  ].filter(Boolean).join("&");

  const sheet = report.sheets[0];
  const previewRows = sheet?.rows.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <h1 className="text-xl font-display font-bold tracking-tight text-ink">
          Rapports financiers
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Journaux, trésorerie et synthèses — exportables en CSV, XLSX et PDF.
        </p>
        <form method="GET" className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Rapport
            <select aria-label="Type de rapport" name="type" defaultValue={type} className={`ml-2 ${input}`}>
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
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
                <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (en cours)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Mode
            <select aria-label="Mode de paiement" name="method" defaultValue={method} className={`ml-2 ${input}`}>
              <option value="">Tous</option>
              {Object.entries(TREASURY_METHOD_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          {type === "expenses" || type === "expenses-by-category" ? (
            <label className="block text-sm">
              Catégorie
              <select aria-label="Catégorie" name="category" defaultValue={categoryId} className={`ml-2 ${input}`}>
                <option value="">Toutes</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {type === "expenses" ? (
            <label className="block text-sm">
              Statut
              <select aria-label="Statut" name="status" defaultValue={status} className={`ml-2 ${input}`}>
                <option value="">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="PAID">Payée</option>
                <option value="CANCELLED">Annulée</option>
              </select>
            </label>
          ) : null}
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Générer
          </button>
        </form>
      </div>

      {report.kpis.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {report.kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} />
          ))}
        </div>
      ) : null}

      <DashCard
        title={report.title}
        sub={report.meta.join(" · ") || "Toute la période"}
        className="overflow-hidden"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["csv", "xlsx", "pdf"] as const).map((f) => (
            <a
              key={f}
              href={`/app/fees/reports/export?${exportQs}&format=${f}`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-700 hover:bg-mist"
            >
              {f}
            </a>
          ))}
          <span className="text-xs text-zinc-400">
            {report.rowCount} ligne{report.rowCount > 1 ? "s" : ""}
            {report.truncated ? " — plafond atteint, affinez les filtres" : ""}
          </span>
        </div>
        {sheet && previewRows.length ? (
          <div className="overflow-x-auto">
            <table aria-label="Aperçu du rapport" className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                  {sheet.headers.map((h) => (
                    <th key={h} scope="col" className="py-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0">
                    {r.map((v, j) => (
                      <td key={j} className="py-1.5 pr-3">
                        {typeof v === "number" ? v.toLocaleString("fr-FR") : (v ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {sheet.totals ? (
                  <tr className="border-t-2 border-zinc-300 font-semibold">
                    {sheet.totals.map((v, j) => (
                      <td key={j} className="py-2 pr-3">
                        {typeof v === "number" ? v.toLocaleString("fr-FR") : (v ?? "")}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
            {sheet.rows.length > PREVIEW_ROWS ? (
              <p className="mt-2 text-xs text-zinc-400">
                Aperçu limité à {PREVIEW_ROWS} lignes — l&apos;export contient
                la totalité ({sheet.rows.length}).
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState
            message="Aucune donnée sur la période."
            hint="Élargissez la période ou ajustez les filtres."
          />
        )}
        {report.notes.length ? (
          <ul className="mt-4 space-y-1 border-t border-zinc-100 pt-3">
            {report.notes.map((n, i) => (
              <li key={i} className="text-xs text-zinc-500">— {n}</li>
            ))}
          </ul>
        ) : null}
      </DashCard>
    </div>
  );
}
