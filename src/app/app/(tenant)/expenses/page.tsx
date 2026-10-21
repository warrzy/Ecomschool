import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  ensureDefaultExpenseCategories,
  listExpenseCategories,
  listExpenses,
} from "@/lib/services/finance/expenses";
import {
  cancelExpenseAction,
  createExpenseAction,
  payExpenseAction,
} from "@/app/app/(tenant)/expenses/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

export default async function ExpensesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("expenses.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const confirm = str("confirm");
  const pay = str("pay");
  const targetId = str("id");

  const [canCreate, canPay, canCancel, canManageCategories] =
    await Promise.all([
      userHasSchoolPermission({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
        permissionKey: "expenses.create",
      }),
      userHasSchoolPermission({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
        permissionKey: "expenses.pay",
      }),
      userHasSchoolPermission({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
        permissionKey: "expenses.cancel",
      }),
      userHasSchoolPermission({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
        permissionKey: "expenses.categories.manage",
      }),
    ]);

  await ensureDefaultExpenseCategories(c);
  const [categories, years] = await Promise.all([
    listExpenseCategories(c),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
  ]);

  const yearId = str("year") ?? "";
  const categoryId = str("category") ?? "";
  const status = str("status") ?? "";

  const expenses = await listExpenses(c, {
    academicYearId: yearId || undefined,
    categoryId: categoryId || undefined,
    status:
      status === "DRAFT" || status === "PAID" || status === "CANCELLED"
        ? status
        : undefined,
  });

  const totalPaid = expenses
    .filter((e) => e.status === "PAID")
    .reduce((s, e) => s + e.amount, 0);
  const totalDraft = expenses
    .filter((e) => e.status === "DRAFT")
    .reduce((s, e) => s + e.amount, 0);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const cancelTarget =
    confirm === "cancel" ? expenses.find((e) => e.id === targetId) : undefined;
  const payTarget = pay ? expenses.find((e) => e.id === pay) : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Dépenses ({expenses.length})
          </h1>
          {canManageCategories ? (
            <Link
              href="/app/expenses/categories"
              className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
            >
              Catégories
            </Link>
          ) : null}
        </div>
        {ok ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {errorMessage(error)}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 p-4">
            <div className="text-xs uppercase text-zinc-500">Décaissé</div>
            <div className="mt-1 text-lg font-semibold">{fmt(totalPaid)}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4">
            <div className="text-xs uppercase text-zinc-500">
              Brouillons à payer
            </div>
            <div className="mt-1 text-lg font-semibold">{fmt(totalDraft)}</div>
          </div>
        </div>
      </div>

      {cancelTarget ? (
        <ConfirmPanel
          title="Confirmer l'annulation de la dépense"
          tone="warning"
          action={cancelExpenseAction}
          fields={{ id: cancelTarget.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif d'annulation",
              required: true,
              placeholder: "Ex. erreur de saisie, décaissement annulé",
            },
          ]}
          confirmLabel="Annuler la dépense"
          cancelHref="/app/expenses"
        >
          La dépense «{" "}
          <span className="font-medium">{cancelTarget.label}</span> » (
          {fmt(cancelTarget.amount)}) sera marquée annulée. La trace du
          décaissement initial et de son annulation est conservée — aucune
          suppression n&apos;a lieu.
        </ConfirmPanel>
      ) : null}

      {payTarget ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm text-amber-900">
          <div className="text-sm font-semibold">Confirmer le paiement</div>
          <div className="mt-2 text-sm">
            La dépense « <span className="font-medium">{payTarget.label}</span>{" "}
            » ({fmt(payTarget.amount)}) passera au statut payée : le
            décaissement sera comptabilisé dans les sorties de trésorerie.
          </div>
          <form action={payExpenseAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={payTarget.id} />
            <label className="block text-sm">
              Mode de paiement <span aria-hidden="true" className="text-red-600">*</span>
              <select aria-label="Mode de paiement" name="method" required className={`ml-2 ${input}`}>
                {Object.entries(METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Date de paiement
              <input
                aria-label="Date de paiement"
                name="paidAt"
                type="date"
                defaultValue={today}
                className={`ml-2 ${input}`}
              />
            </label>
            <label className="block text-sm">
              Référence de paiement
              <input
                aria-label="Référence de paiement"
                name="paymentReference"
                className={`ml-2 ${input}`}
              />
            </label>
            <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Confirmer
            </SubmitButton>
            <Link
              href="/app/expenses"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
            >
              Annuler
            </Link>
          </form>
        </div>
      ) : null}

      {canCreate ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Nouvelle dépense
          </div>
          <form action={createExpenseAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              Catégorie <span aria-hidden="true" className="text-red-600">*</span>
              <select aria-label="Catégorie" name="categoryId" required className={`mt-1 w-full ${input}`}>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Année scolaire
              <select aria-label="Année scolaire" name="academicYearId" defaultValue={years.find((y) => y.isCurrent)?.id ?? ""} className={`mt-1 w-full ${input}`}>
                <option value="">Hors année</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              Libellé <span aria-hidden="true" className="text-red-600">*</span>
              <input aria-label="Libellé" name="label" required className={`mt-1 w-full ${input}`} placeholder="Ex. Facture électricité octobre" />
            </label>
            <label className="block text-sm">
              Montant (FCFA) <span aria-hidden="true" className="text-red-600">*</span>
              <input aria-label="Montant" name="amount" type="number" min={1} step={1} required className={`mt-1 w-full ${input}`} />
            </label>
            <label className="block text-sm">
              Bénéficiaire <span aria-hidden="true" className="text-red-600">*</span>
              <input aria-label="Bénéficiaire" name="beneficiary" required className={`mt-1 w-full ${input}`} placeholder="Nom du fournisseur ou agent" />
            </label>
            <label className="block text-sm">
              Date de dépense <span aria-hidden="true" className="text-red-600">*</span>
              <input aria-label="Date de dépense" name="expenseAt" type="date" defaultValue={today} required className={`mt-1 w-full ${input}`} />
            </label>
            <label className="block text-sm">
              Référence de justificatif
              <input aria-label="Référence de justificatif" name="attachmentRef" className={`mt-1 w-full ${input}`} placeholder="N° facture, pièce…" />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Enregistrer la dépense
              </SubmitButton>
            </div>
          </form>
          <p className="mt-2 text-xs text-zinc-500">
            La dépense est enregistrée en brouillon : elle n&apos;est
            comptabilisée en trésorerie qu&apos;au passage « payée ».
          </p>
        </div>
      ) : null}

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select aria-label="Année scolaire" name="year" defaultValue={yearId} className={input}>
            <option value="">Toutes les années</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select aria-label="Catégorie" name="category" defaultValue={categoryId} className={input}>
            <option value="">Toutes les catégories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
          <select aria-label="Statut" name="status" defaultValue={status} className={input}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Filtrer
          </button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table aria-label="Liste des dépenses" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2">Date</th>
                <th scope="col" className="py-2">Libellé</th>
                <th scope="col" className="py-2">Catégorie</th>
                <th scope="col" className="py-2">Bénéficiaire</th>
                <th scope="col" className="py-2">Année</th>
                <th scope="col" className="py-2">Payée le</th>
                <th scope="col" className="py-2">Statut</th>
                <th scope="col" className="py-2 text-right">Montant</th>
                <th scope="col" className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{dstr(e.expenseAt)}</td>
                  <td className="py-2">
                    {e.label}
                    {e.cancelReason ? (
                      <div className="text-xs text-zinc-500">
                        Motif : {e.cancelReason}
                      </div>
                    ) : null}
                    {e.attachmentRef ? (
                      <div className="text-xs text-zinc-500">
                        Justificatif : {e.attachmentRef}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">{e.category.label}</td>
                  <td className="py-2">{e.beneficiary}</td>
                  <td className="py-2">{e.academicYear?.name ?? "—"}</td>
                  <td className="py-2">
                    {dstr(e.paidAt)}
                    {e.method ? (
                      <div className="text-xs text-zinc-500">
                        {METHOD_LABELS[e.method] ?? e.method}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <span
                      className={`text-xs font-medium ${
                        e.status === "PAID"
                          ? "text-emerald-700"
                          : e.status === "CANCELLED"
                            ? "text-red-700"
                            : "text-zinc-600"
                      }`}
                    >
                      {STATUS_LABELS[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="py-2 text-right font-medium">{fmt(e.amount)}</td>
                  <td className="py-2 text-right">
                    <span className="flex items-center justify-end gap-2">
                      {e.status === "DRAFT" && canPay ? (
                        <Link
                          href={`/app/expenses?pay=${e.id}`}
                          className="text-xs text-brand-700 underline"
                        >
                          Payer
                        </Link>
                      ) : null}
                      {e.status !== "CANCELLED" && canCancel ? (
                        <Link
                          href={`/app/expenses?confirm=cancel&id=${e.id}`}
                          className="text-xs text-red-700 underline"
                        >
                          Annuler
                        </Link>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-3 text-zinc-500">
                    Aucune dépense.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
