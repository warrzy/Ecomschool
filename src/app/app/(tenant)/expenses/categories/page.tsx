import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  ensureDefaultExpenseCategories,
  listExpenseCategories,
} from "@/lib/services/finance/expenses";
import {
  archiveExpenseCategoryAction,
  createExpenseCategoryAction,
} from "@/app/app/(tenant)/expenses/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

export default async function ExpenseCategoriesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("expenses.categories.manage");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const confirm = str("confirm");
  const confirmId = str("id");

  await ensureDefaultExpenseCategories(c);
  const categories = await listExpenseCategories(c, { includeArchived: true });

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const confirmCategory =
    confirm === "archive-category"
      ? categories.find((cat) => cat.id === confirmId)
      : undefined;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/expenses" className="hover:underline">
            Dépenses
          </Link>{" "}
          / Catégories
        </div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Catégories de dépenses
        </h1>
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
      </div>

      {confirmCategory ? (
        <ConfirmPanel
          title="Confirmer l'archivage de la catégorie"
          tone="warning"
          action={archiveExpenseCategoryAction}
          fields={{ id: confirmCategory.id }}
          confirmLabel="Archiver"
          cancelHref="/app/expenses/categories"
        >
          La catégorie «{" "}
          <span className="font-medium">{confirmCategory.label}</span> » ne
          sera plus proposée pour les nouvelles dépenses. Les dépenses
          existantes restent attachées et consultables.
        </ConfirmPanel>
      ) : null}

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Nouvelle catégorie
        </div>
        <form action={createExpenseCategoryAction} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Code
            <input
              aria-label="Code"
              name="code"
              required
              maxLength={30}
              className={`ml-2 ${input}`}
              placeholder="EX. RESTAURATION"
            />
          </label>
          <label className="block text-sm">
            Libellé
            <input
              aria-label="Libellé"
              name="label"
              required
              maxLength={120}
              className={`ml-2 ${input}`}
            />
          </label>
          <label className="block text-sm">
            Description
            <input
              aria-label="Description"
              name="description"
              className={`ml-2 ${input}`}
            />
          </label>
          <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Enregistrer
          </SubmitButton>
        </form>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table aria-label="Catégories de dépenses" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2">Code</th>
                <th scope="col" className="py-2">Libellé</th>
                <th scope="col" className="py-2">Description</th>
                <th scope="col" className="py-2">Statut</th>
                <th scope="col" className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 font-mono text-xs">{cat.code}</td>
                  <td className="py-2">{cat.label}</td>
                  <td className="py-2 text-zinc-600">{cat.description ?? "—"}</td>
                  <td className="py-2">
                    <span
                      className={`text-xs font-medium ${
                        cat.status === "ACTIVE" ? "text-emerald-700" : "text-zinc-500"
                      }`}
                    >
                      {cat.status === "ACTIVE" ? "Active" : "Archivée"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {cat.status === "ACTIVE" ? (
                      <Link
                        href={`/app/expenses/categories?confirm=archive-category&id=${cat.id}`}
                        className="text-xs text-red-700 underline"
                      >
                        Archiver
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-zinc-500">
                    Aucune catégorie.
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
