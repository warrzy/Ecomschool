import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  listCashClosures,
  listPayments,
  paymentsStats,
} from "@/lib/services/finance/payments";
import {
  cancelPaymentAction,
  closeCashAction,
} from "@/app/app/(tenant)/fees/actions";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const PAGE_SIZE = 50;
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
  const confirm = str("confirm");
  const confirmId = str("id");

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
  const cashier = str("cashier") || undefined;
  const q = str("q")?.trim() || undefined;
  const status = (["VALIDATED", "CANCELLED"] as const).find(
    (s) => s === str("status"),
  ) as PaymentStatus | undefined;
  const page = Math.max(1, parseInt(str("page") ?? "1", 10) || 1);

  const filters = {
    academicYearId: yearId,
    method: method || undefined,
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59Z`) : undefined,
    receivedById: cashier,
    query: q,
    status,
    includeCancelled: !status,
  };
  // Totaux calculés en base sur tout l'ensemble filtré (pas la page seule).
  const stats = await paymentsStats(c, filters);
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const dayStats = await paymentsStats(c, { ...filters, from: dayStart, to: dayEnd });
  const pageCount = Math.max(1, Math.ceil(stats.count / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const [payments, closures] = await Promise.all([
    listPayments(c, filters, {
      take: PAGE_SIZE,
      skip: (safePage - 1) * PAGE_SIZE,
    }),
    listCashClosures(c),
  ]);
  const totalFiltered = stats.validatedTotal;
  const cancelledCount = stats.cancelledCount;
  const totalDay = dayStats.validatedTotal;

  // « Encaissé par » : receivedById sans relation → jointure manuelle sur les
  // utilisateurs ayant réellement encaissé dans cet établissement.
  const cashierRows = await prisma.payment.findMany({
    where: { schoolId: tenant.schoolId, receivedById: { not: null } },
    distinct: ["receivedById"],
    select: { receivedById: true },
  });
  const cashierUsers = await prisma.user.findMany({
    where: {
      id: { in: cashierRows.map((r) => r.receivedById!) },
      memberships: { some: { schoolId: tenant.schoolId } },
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { lastName: "asc" },
  });
  const agentBy = new Map(
    cashierUsers.map((u) => [
      u.id,
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
    ]),
  );

  const pageRows = payments; // fenêtre déjà paginée côté serveur (skip/take)

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const exportParams = `year=${yearId ?? ""}&from=${from ?? ""}&to=${to ?? ""}&method=${method ?? ""}${status ? `&status=${status}` : ""}${cashier ? `&cashier=${cashier}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const csvHref = `/app/fees/payments/export?format=csv&${exportParams}`;
  const xlsxHref = `/app/fees/payments/export?format=xlsx&${exportParams}`;
  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    if (yearId) u.set("year", yearId);
    if (method) u.set("method", method);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (cashier) u.set("cashier", cashier);
    if (q) u.set("q", q);
    if (status) u.set("status", status);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  const confirmPayment = payments.find((p) => p.id === confirmId);
  const cancelHref = `/app/fees/payments${yearId ? `?year=${yearId}` : ""}`;

  return (
    <div className="space-y-4">
      {canClose && confirm === "close-cash" ? (
        <ConfirmPanel
          title="Confirmer la clôture de caisse"
          action={closeCashAction}
          fields={{}}
          inputs={[
            {
              name: "date",
              label: "Date de la journée à clôturer :",
              type: "date",
              required: true,
              defaultValue: dstr(new Date()),
            },
          ]}
          confirmLabel="Clôturer la journée"
          cancelHref={cancelHref}
        >
          La clôture fige la journée choisie : aucun encaissement ne pourra plus
          être enregistré à cette date (<code>CLOSED_DAY</code>).{" "}
          <strong>Cette action est irréversible.</strong>
        </ConfirmPanel>
      ) : null}
      {canCancel && confirm === "cancel" && confirmPayment ? (
        <ConfirmPanel
          title="Confirmer l'annulation du paiement"
          tone="danger"
          action={cancelPaymentAction}
          fields={{ id: confirmPayment.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif de l'annulation :",
              required: true,
              placeholder: "Erreur de saisie, doublon…",
            },
          ]}
          confirmLabel="Annuler le paiement"
          cancelHref={cancelHref}
        >
          Annuler le paiement <strong>{confirmPayment.receiptNumber}</strong> de{" "}
          <strong>{fmt(confirmPayment.amount)}</strong> —{" "}
          {confirmPayment.student.firstName} {confirmPayment.student.lastName} —
          le contredit dans le journal et recalcule les soldes.{" "}
          <strong>Cette action est irréversible</strong> et reste tracée dans
          l&apos;audit.
        </ConfirmPanel>
      ) : null}
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Journal des paiements
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Encaissements ({stats.count}) — total filtré : {fmt(totalFiltered)} — aujourd&apos;hui : {fmt(totalDay)}
            {cancelledCount > 0 ? (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                dont {cancelledCount} annulé{cancelledCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <a href={csvHref} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-mist">
              Export CSV
            </a>
            <a href={xlsxHref} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-mist">
              Export Excel
            </a>
            {canClose ? (
              <Link
                href={`/app/fees/payments?confirm=close-cash${yearId ? `&year=${yearId}` : ""}`}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"
              >
                Clôturer la caisse
              </Link>
            ) : null}
          </div>
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "cancelled" ? "Paiement annulé (contre-écriture auditée)." : okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "CLOSED_DAY" ? "Journée déjà clôturée." : error === "ALREADY_CANCELLED" ? "Paiement déjà annulé." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="year" value={yearId ?? ""} />
          <input
            aria-label="Rechercher"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Élève, matricule, référence ou n° reçu…"
            className={`${input} min-w-56`}
          />
          <input aria-label="Du" name="from" type="date" defaultValue={from ?? ""} className={input} />
          <input aria-label="Au" name="to" type="date" defaultValue={to ?? ""} className={input} />
          <select
                  aria-label="Tous modes" name="method" defaultValue={method ?? ""} className={input}>
            <option value="">Tous modes</option>
            {Object.entries(METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
                  aria-label="Tous les caissiers" name="cashier" defaultValue={cashier ?? ""} className={input}>
            <option value="">Tous les caissiers</option>
            {cashierUsers.map((u) => (
              <option key={u.id} value={u.id}>{agentBy.get(u.id)}</option>
            ))}
          </select>
          <select
                  aria-label="Tous statuts" name="status" defaultValue={status ?? ""} className={input}>
            <option value="">Tous statuts</option>
            <option value="VALIDATED">Validés</option>
            <option value="CANCELLED">Annulés</option>
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Filtrer
          </button>
          {q || cashier || status || method || from || to ? (
            <Link href={`/app/fees/payments${yearId ? `?year=${yearId}` : ""}`} className="text-sm text-zinc-500 underline">
              Réinitialiser
            </Link>
          ) : null}
        </form>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Paiements" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2">Reçu</th>
              <th scope="col" className="py-2">Élève</th>
              <th scope="col" className="py-2">Mode</th>
              <th scope="col" className="py-2">Référence</th>
              <th scope="col" className="py-2">Encaissé par</th>
              <th scope="col" className="py-2 text-right">Montant</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{dstr(p.paidAt)}</td>
                <td className="py-2 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                <td className="py-2">{p.student.firstName} {p.student.lastName}</td>
                <td className="py-2">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="py-2">{p.reference ?? "—"}</td>
                <td className="py-2 text-xs">{p.receivedById ? (agentBy.get(p.receivedById) ?? "—") : "—"}</td>
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
                    <Link
                      href={`/app/fees/payments?confirm=cancel&id=${p.id}${yearId ? `&year=${yearId}` : ""}`}
                      className="text-red-600 hover:underline"
                    >
                      Annuler
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
            {payments.length === 0 ? (
              <tr><td colSpan={9} className="py-3 text-zinc-500">
                {q || cashier || status || method || from || to
                  ? "Aucun paiement ne correspond à ces filtres."
                  : "Aucun paiement."}
              </td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
        {pageCount > 1 ? (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <span className="text-zinc-500">
              Page {safePage} / {pageCount} — {stats.count} opération(s)
            </span>
            <div className="flex gap-2">
              {safePage > 1 ? (
                <Link href={pageHref(safePage - 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-mist">
                  Précédent
                </Link>
              ) : null}
              {safePage < pageCount ? (
                <Link href={pageHref(safePage + 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-mist">
                  Suivant
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Clôtures de caisse</div>
        <div className="overflow-x-auto">
        <table aria-label="Clôtures de caisse" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2 text-right">Total</th>
              <th scope="col" className="py-2 text-right">Paiements</th>
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
    </div>
  );
}
