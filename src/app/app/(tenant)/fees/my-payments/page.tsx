import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { listPayments } from "@/lib/services/finance/payments";
import type { PaymentStatus } from "@prisma/client";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const tstr = (d: Date) => d.toISOString().slice(11, 16);
const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};
const PAGE_SIZE = 50;

export default async function MyPaymentsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Journal personnel — finance.receipts.read (FINANCE_CORE), jamais
  // finance.reports.read : le filtre receivedById est imposé côté serveur
  // sur l'utilisateur authentifié, sans paramètre navigateur.
  const tenant = await requireSchoolPermission("finance.receipts.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const canPrint = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "finance.receipts.print",
  });

  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = str("q")?.trim() || undefined;
  const from = str("from");
  const to = str("to");
  const status = (["VALIDATED", "CANCELLED"] as const).find(
    (s) => s === str("status"),
  ) as PaymentStatus | undefined;
  const page = Math.max(1, parseInt(str("page") ?? "1", 10) || 1);

  const payments = await listPayments(
    c,
    {
      receivedById: tenant.userId,
      query: q,
      from: from ? new Date(`${from}T00:00:00Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59Z`) : undefined,
      status,
      includeCancelled: !status,
    },
    { take: 2000 },
  );

  // Classe de l'élève (si disponible) via l'inscription de l'année du paiement.
  const yearIds = [...new Set(payments.map((p) => p.academicYearId))];
  const studentIds = [...new Set(payments.map((p) => p.studentId))];
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: tenant.schoolId,
      academicYearId: { in: yearIds },
      studentId: { in: studentIds },
      status: "ENROLLED",
    },
    select: {
      studentId: true,
      academicYearId: true,
      classroom: { select: { name: true } },
    },
  });
  const classBy = new Map(
    enrollments.map((e) => [
      `${e.studentId}:${e.academicYearId}`,
      e.classroom.name,
    ]),
  );

  // Totaux conformes au journal : recettes = VALIDATED uniquement.
  const totalValidated = payments
    .filter((p) => p.status === "VALIDATED")
    .reduce((s, p) => s + p.amount, 0);
  const cancelledCount = payments.filter((p) => p.status === "CANCELLED").length;

  const pageCount = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = payments.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (status) u.set("status", status);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Mes encaissements
        </div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Mes encaissements ({payments.length}) — total : {fmt(totalValidated)}
          {cancelledCount > 0 ? (
            <span className="ml-2 text-sm font-normal text-zinc-500">
              dont {cancelledCount} annulé{cancelledCount > 1 ? "s" : ""}
            </span>
          ) : null}
        </h1>
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
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
          <select aria-label="Tous statuts" name="status" defaultValue={status ?? ""} className={input}>
            <option value="">Tous statuts</option>
            <option value="VALIDATED">Validés</option>
            <option value="CANCELLED">Annulés</option>
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Rechercher
          </button>
          {q || from || to || status ? (
            <Link href="/app/fees/my-payments" className="text-sm text-zinc-500 underline">
              Réinitialiser
            </Link>
          ) : null}
        </form>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Mes encaissements" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2">Reçu</th>
              <th scope="col" className="py-2">Élève</th>
              <th scope="col" className="py-2">Classe</th>
              <th scope="col" className="py-2">Mode</th>
              <th scope="col" className="py-2">Référence</th>
              <th scope="col" className="py-2 text-right">Montant</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 whitespace-nowrap">{dstr(p.paidAt)} {tstr(p.paidAt)}</td>
                <td className="py-2 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                <td className="py-2">
                  <Link
                    href={`/app/fees/accounts/${p.studentId}?year=${p.academicYearId}`}
                    className="hover:underline"
                  >
                    {p.student.firstName} {p.student.lastName}
                  </Link>
                  <div className="font-mono text-xs text-zinc-500">{p.student.matricule}</div>
                </td>
                <td className="py-2">{classBy.get(`${p.studentId}:${p.academicYearId}`) ?? "—"}</td>
                <td className="py-2">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="py-2">{p.reference ?? "—"}</td>
                <td className="py-2 text-right font-medium">{fmt(p.amount)}</td>
                <td className={`py-2 text-xs ${p.status === "CANCELLED" ? "text-red-700" : "text-emerald-700"}`}>
                  {p.status === "CANCELLED" ? "Annulé" : "Validé"}
                </td>
                <td className="py-2 text-right text-xs">
                  {canPrint && p.status === "VALIDATED" && p.receiptNumber ? (
                    <a href={`/app/fees/receipts/pdf?payment=${p.id}`} target="_blank" className="underline">
                      PDF
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
            {payments.length === 0 ? (
              <tr><td colSpan={9} className="py-3 text-zinc-500">
                {q || from || to || status
                  ? "Aucun encaissement ne correspond à ces filtres."
                  : "Aucun encaissement enregistré."}
              </td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
        {pageCount > 1 ? (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <span className="text-zinc-500">
              Page {safePage} / {pageCount} — {payments.length} opération(s)
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
    </div>
  );
}
