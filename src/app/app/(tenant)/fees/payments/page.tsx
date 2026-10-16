import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { listCashClosures, listPayments } from "@/lib/services/finance/payments";
import {
  cancelPaymentAction,
  closeCashAction,
} from "@/app/app/(tenant)/fees/actions";
import type { PaymentMethod } from "@prisma/client";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

export default async function PaymentsJournalPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");

  const [canCancel, canClose, canPrint] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.payments.cancel" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.cash.close" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.receipts.print" }),
  ]);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId = str("year") ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id;
  const method = str("method") as PaymentMethod | undefined;
  const from = str("from");
  const to = str("to");
  const includeCancelled = str("cancelled") === "1";

  const payments = await listPayments(c, {
    academicYearId: yearId,
    method: method || undefined,
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59Z`) : undefined,
    includeCancelled,
  });
  const closures = await listCashClosures(c);
  const totalDay = payments
    .filter((p) => p.status === "VALIDATED" && dstr(p.paidAt) === dstr(new Date()))
    .reduce((s, p) => s + p.amount, 0);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const exportParams = `year=${yearId ?? ""}&from=${from ?? ""}&to=${to ?? ""}&method=${method ?? ""}${includeCancelled ? "" : "&status=VALIDATED"}`;
  const csvHref = `/app/fees/payments/export?format=csv&${exportParams}`;
  const xlsxHref = `/app/fees/payments/export?format=xlsx&${exportParams}`;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Journal des paiements
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xl font-semibold tracking-tight text-zinc-900">
            Encaissements ({payments.length}) — aujourd&apos;hui : {fmt(totalDay)}
          </div>
          <div className="flex items-center gap-2">
            <a href={csvHref} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">
              Export CSV
            </a>
            <a href={xlsxHref} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">
              Export Excel
            </a>
            {canClose ? (
              <form action={closeCashAction} className="flex items-center gap-2">
                <input name="date" type="date" defaultValue={dstr(new Date())} className={input} />
                <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
                  Clôturer la caisse
                </button>
              </form>
            ) : null}
          </div>
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "cancelled" ? "Paiement annulé (contre-écriture auditée)." : ok === "closed" ? "Journée clôturée." : ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "CLOSED_DAY" ? "Journée déjà clôturée." : error === "ALREADY_CANCELLED" ? "Paiement déjà annulé." : error}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="year" value={yearId ?? ""} />
          <input name="from" type="date" defaultValue={from ?? ""} className={input} />
          <input name="to" type="date" defaultValue={to ?? ""} className={input} />
          <select name="method" defaultValue={method ?? ""} className={input}>
            <option value="">Tous modes</option>
            {Object.entries(METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="cancelled" value="1" defaultChecked={includeCancelled} /> Inclure annulés
          </label>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
        </form>
      </div>

      <div className={card}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">Date</th>
              <th className="py-2">Reçu</th>
              <th className="py-2">Élève</th>
              <th className="py-2">Mode</th>
              <th className="py-2">Référence</th>
              <th className="py-2 text-right">Montant</th>
              <th className="py-2">Statut</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{dstr(p.paidAt)}</td>
                <td className="py-2 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                <td className="py-2">{p.student.firstName} {p.student.lastName}</td>
                <td className="py-2">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="py-2">{p.reference ?? "—"}</td>
                <td className="py-2 text-right font-medium">{fmt(p.amount)}</td>
                <td className={`py-2 text-xs ${p.status === "CANCELLED" ? "text-red-700" : "text-emerald-700"}`}>
                  {p.status === "CANCELLED" ? "Annulé" : "Validé"}
                </td>
                <td className="py-2 text-right text-xs">
                  {canPrint && p.status === "VALIDATED" ? (
                    <a href={`/app/fees/receipts/pdf?payment=${p.id}`} target="_blank" className="mr-2 underline">
                      PDF
                    </a>
                  ) : null}
                  {canCancel && p.status === "VALIDATED" ? (
                    <form action={cancelPaymentAction} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="reason" placeholder="Motif" required className="mr-1 w-28 rounded border border-zinc-200 px-1 py-0.5 text-xs" />
                      <button type="submit" className="text-red-600 hover:underline">Annuler</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {payments.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-zinc-500">Aucun paiement.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Clôtures de caisse</div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Paiements</th>
            </tr>
          </thead>
          <tbody>
            {closures.map((cl) => (
              <tr key={cl.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{dstr(cl.date)}</td>
                <td className="py-2 text-right font-medium">{fmt(cl.totalAmount)}</td>
                <td className="py-2 text-right">{cl.paymentsCount}</td>
              </tr>
            ))}
            {closures.length === 0 ? (
              <tr><td colSpan={3} className="py-3 text-zinc-500">Aucune clôture.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
