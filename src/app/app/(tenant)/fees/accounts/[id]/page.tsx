import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { getStudentAccount, studentFinanceYears } from "@/lib/services/finance/accounts";
import {
  archiveDiscountAction,
  createDiscountAction,
  recordPaymentAction,
  updateInstallmentAction,
} from "@/app/app/(tenant)/fees/actions";
import { regenerateStudentChargesAction } from "@/app/app/(tenant)/fees/registration/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const INST_LABELS: Record<string, string> = {
  UPCOMING: "À venir",
  PARTIAL: "Partiel",
  PAID: "Payé",
  LATE: "En retard",
  CANCELLED: "Annulé",
};
const INST_CLS: Record<string, string> = {
  UPCOMING: "text-zinc-600",
  PARTIAL: "text-amber-700",
  PAID: "text-emerald-700",
  LATE: "text-red-700",
  CANCELLED: "text-zinc-500",
};
const DISCOUNT_LABELS: Record<string, string> = {
  FIXED_AMOUNT: "Remise fixe",
  PERCENT: "Remise %",
  SCHOLARSHIP: "Bourse",
  EXEMPTION: "Exonération",
  FAMILY: "Réduction familiale",
  EXCEPTIONAL: "Ajustement",
};
const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

export default async function StudentAccountPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");
  const confirm = str("confirm");
  const confirmId = str("id");

  const financeYears = await studentFinanceYears(c, id);
  const allYears = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId =
    str("year") ?? financeYears[0]?.id ?? allYears.find((y) => y.isCurrent)?.id ?? allYears[0]?.id;
  if (!yearId) notFound();

  const account = await getStudentAccount(c, { studentId: id, academicYearId: yearId });
  if (!account) notFound();

  const [canManage, canDiscount, canPay, canPrint, canEnroll] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.fees.manage" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.discounts.manage" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.payments.create" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "finance.receipts.print" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "enrollment.create" }),
  ]);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";
  const selfHref = `/app/fees/accounts/${id}?year=${yearId}`;
  const confirmDiscount = account.discounts.find((d) => d.id === confirmId);

  return (
    <div className="space-y-4">
      {canDiscount && confirm === "archive-discount" && confirmDiscount ? (
        <ConfirmPanel
          title="Confirmer l'archivage de la réduction"
          action={archiveDiscountAction}
          fields={{ id: confirmDiscount.id, studentId: id, academicYearId: yearId }}
          confirmLabel="Archiver la réduction"
          cancelHref={selfHref}
        >
          Archiver la réduction{" "}
          <strong>
            {DISCOUNT_LABELS[confirmDiscount.type] ?? confirmDiscount.type} —{" "}
            {confirmDiscount.reason}
          </strong>{" "}
          de {account.student.firstName} {account.student.lastName} la retire
          des prochains calculs de soldes. Les montants déjà appliqués restent
          tracés.
        </ConfirmPanel>
      ) : null}
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees/accounts" className="hover:underline">Comptes élèves</Link> / Dossier
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            {account.student.firstName} {account.student.lastName}
            <span className="ml-2 font-mono text-sm font-normal text-zinc-500">{account.student.matricule}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <form method="GET">
              <select
                  aria-label="Année scolaire" name="year" defaultValue={yearId} className={input}>
                {allYears.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </select>
              <button type="submit" className="ml-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm">
                Afficher
              </button>
            </form>
            <Link
              href="/app/fees/accounts"
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
            >
              Retour
            </Link>
          </div>
        </div>
        <div className="mt-1 text-sm text-zinc-500">
          Classe : {account.student.classroomName ?? "—"}
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "payment" ? `Paiement enregistré — reçu ${sp.receipt ?? ""}.` : okMessage(ok)}
            {ok === "registered_charges_failed" && canEnroll ? (
              <form action={regenerateStudentChargesAction} className="mt-2">
                <input type="hidden" name="studentId" value={id} />
                <input type="hidden" name="academicYearId" value={yearId} />
                <SubmitButton
                  pendingLabel="Génération…"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Relancer la génération des créances
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "CLOSED_DAY" ? "Journée de caisse clôturée — encaissement refusé." : error === "OVERPAYMENT" ? "Montant supérieur au solde restant dû — vérifiez le solde avant d'encaisser." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Frais", account.totals.charges],
          ["Réductions", account.totals.discounts],
          ["Exigible", account.totals.due],
          ["Payé", account.totals.paid],
          ["Solde", account.totals.balance],
        ].map(([label, v]) => (
          <div key={label as string} className={card}>
            <div className="text-xs uppercase text-zinc-500">{label as string}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{fmt(v as number)}</div>
          </div>
        ))}
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Échéances</div>
        <div className="overflow-x-auto">
        <table aria-label="Échéances" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Catégorie</th>
              <th scope="col" className="py-2">Tranche</th>
              <th scope="col" className="py-2">Échéance</th>
              <th scope="col" className="py-2 text-right">Montant</th>
              <th scope="col" className="py-2 text-right">Payé</th>
              <th scope="col" className="py-2 text-right">Reste</th>
              <th scope="col" className="py-2">Statut</th>
              {canManage ? <th scope="col" className="py-2"></th> : null}
            </tr>
          </thead>
          <tbody>
            {account.installments.map((i) => (
              <tr key={i.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{i.categoryLabel}</td>
                <td className="py-2">{i.label ?? "—"}</td>
                <td className="py-2">{dstr(i.dueDate)}</td>
                <td className="py-2 text-right">{fmt(i.amount)}</td>
                <td className="py-2 text-right">{fmt(i.paidAmount)}</td>
                <td className="py-2 text-right font-medium">{fmt(i.remaining)}</td>
                <td className={`py-2 text-xs font-medium ${INST_CLS[i.computedStatus]}`}>
                  {INST_LABELS[i.computedStatus]}
                </td>
                {canManage ? (
                  <td className="py-2">
                    <form action={updateInstallmentAction} className="flex gap-1">
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="studentId" value={id} />
                      <input type="hidden" name="academicYearId" value={yearId} />
                      <input aria-label="Date d'échéance" name="dueDate" type="date" defaultValue={dstr(i.dueDate)} className="w-32 rounded border border-zinc-200 px-1 py-0.5 text-xs" />
                      <input aria-label="Montant" name="amount" type="number" min="0" defaultValue={i.amount} className="w-24 rounded border border-zinc-200 px-1 py-0.5 text-xs" />
                      <button type="submit" className="text-xs text-zinc-600 hover:underline">OK</button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
            {account.installments.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-zinc-500">Aucune échéance.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Réductions & bourses</div>
          <div className="overflow-x-auto">
          <table aria-label="Réductions et bourses" className="w-full text-left text-sm">
            <tbody>
              {account.discounts.map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">
                    <div>{DISCOUNT_LABELS[d.type] ?? d.type}</div>
                    <div className="text-xs text-zinc-500">{d.reason}</div>
                  </td>
                  <td className="py-2 text-right">
                    {d.type === "PERCENT" ? `${d.value} %` : d.type === "EXEMPTION" ? "100 %" : fmt(d.value)}
                  </td>
                  <td className="py-2 text-right text-xs text-zinc-500">
                    {d.status === "ARCHIVED" ? "Archivée" : ""}
                    {canDiscount && d.status === "ACTIVE" ? (
                      <Link
                        href={`/app/fees/accounts/${id}?year=${yearId}&confirm=archive-discount&id=${d.id}`}
                        className="ml-2 text-red-600 hover:underline"
                      >
                        Archiver
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {account.discounts.length === 0 ? (
                <tr><td className="py-2 text-zinc-500">Aucune réduction.</td></tr>
              ) : null}
            </tbody>
          </table>
          </div>
          {canDiscount ? (
            <form action={createDiscountAction} className="mt-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={id} />
              <input type="hidden" name="academicYearId" value={yearId} />
              <select
                  aria-label="Type" name="type" className={input}>
                <option value="FIXED_AMOUNT">Remise fixe</option>
                <option value="PERCENT">Remise %</option>
                <option value="SCHOLARSHIP">Bourse</option>
                <option value="EXEMPTION">Exonération</option>
                <option value="FAMILY">Familiale</option>
                <option value="EXCEPTIONAL">Exceptionnelle</option>
              </select>
              <input aria-label="Valeur" name="value" type="number" min="0" placeholder="Montant ou %" required className={input} />
              <input aria-label="Motif" name="reason" placeholder="Motif" required className={input} />
              <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">
                Ajouter
              </button>
            </form>
          ) : null}
        </div>

        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Encaisser un paiement</div>
          {account.totals.balance <= 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              Frais soldés — aucun encaissement possible tant qu&apos;aucune
              autre créance payable n&apos;existe.
            </div>
          ) : canPay ? (
            <form action={recordPaymentAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={id} />
              <input type="hidden" name="academicYearId" value={yearId} />
              <input type="hidden" name="idempotencyKey" value={globalThis.crypto?.randomUUID?.() ?? ""} />
              <input aria-label="Montant" name="amount" type="number" min="1" placeholder={`Montant (solde ${fmt(account.totals.balance)})`} required className={input} />
              <select
                  aria-label="Mode de paiement" name="method" className={input}>
                <option value="CASH">Espèces</option>
                <option value="BANK_TRANSFER">Virement</option>
                <option value="CHECK">Chèque</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="OTHER">Autre</option>
              </select>
              <input aria-label="Référence" name="reference" placeholder="Référence" className={input} />
              <input aria-label="Observation" name="observation" placeholder="Observation" className={input} />
              <SubmitButton
                pendingLabel="Encaissement…"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
              >
                Encaisser
              </SubmitButton>
            </form>
          ) : (
            <div className="text-sm text-zinc-500">Permission d&apos;encaissement requise.</div>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Le montant est réparti automatiquement sur les échéances les plus anciennes.
          </p>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Historique des paiements</div>
        <div className="overflow-x-auto">
        <table aria-label="Historique des paiements" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2">Reçu</th>
              <th scope="col" className="py-2">Mode</th>
              <th scope="col" className="py-2">Référence</th>
              <th scope="col" className="py-2 text-right">Montant</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {account.payments.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{dstr(p.paidAt)}</td>
                <td className="py-2 font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                <td className="py-2">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="py-2">{p.reference ?? "—"}</td>
                <td className="py-2 text-right font-medium">{fmt(p.amount)}</td>
                <td className={`py-2 text-xs ${p.status === "CANCELLED" ? "text-red-700" : "text-emerald-700"}`}>
                  {p.status === "CANCELLED" ? `Annulé — ${p.cancelReason ?? ""}` : "Validé"}
                </td>
                <td className="py-2 text-right">
                  {canPrint && p.status === "VALIDATED" ? (
                    <a
                      href={`/app/fees/receipts/pdf?payment=${p.id}`}
                      target="_blank"
                      className="text-xs text-zinc-700 underline"
                    >
                      Reçu PDF
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
            {account.payments.length === 0 ? (
              <tr><td colSpan={7} className="py-3 text-zinc-500">Aucun paiement.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
