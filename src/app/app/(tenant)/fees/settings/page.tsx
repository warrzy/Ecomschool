import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  ensureDefaultFeeCategories,
  listFeeCategories,
  listFeeTariffs,
} from "@/lib/services/finance/fees";
import {
  archiveCategoryAction,
  createCategoryAction,
  createTariffAction,
  updateTariffAmountAction,
} from "@/app/app/(tenant)/fees/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default async function FeeSettingsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.configure");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "finance.fees.manage",
  });

  await ensureDefaultFeeCategories(c);
  const [categories, years, levels, classrooms] = await Promise.all([
    listFeeCategories(c),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.classroom.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const yearId =
    (typeof sp.year === "string" ? sp.year : undefined) ??
    years.find((y) => y.isCurrent)?.id ??
    years[0]?.id;
  const tariffs = yearId
    ? await listFeeTariffs(c, { academicYearId: yearId, includeArchived: true })
    : [];

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const confirmCategory = categories.find((cat) => cat.id === confirmId);

  return (
    <div className="space-y-4">
      {confirm === "archive-category" && confirmCategory ? (
        <ConfirmPanel
          title="Confirmer l'archivage de la catégorie"
          action={archiveCategoryAction}
          fields={{ id: confirmCategory.id }}
          confirmLabel="Archiver la catégorie"
          cancelHref="/app/fees/settings"
        >
          Archiver la catégorie <strong>{confirmCategory.label}</strong> (
          {confirmCategory.code}) la retire des nouveaux tarifs et de la
          génération de frais. Les créances existantes sont conservées.
        </ConfirmPanel>
      ) : null}
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Configuration
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Catégories & tarifs
          </h1>
          <Link
            href="/app/fees"
            className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retour
          </Link>
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "DUPLICATE" ? "Code déjà utilisé." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Catégories de frais</div>
        <form action={createCategoryAction} className="mb-4 flex flex-wrap items-end gap-3">
          <input aria-label="Code" name="code" placeholder="Code" required className={input} />
          <input aria-label="Libellé" name="label" placeholder="Libellé" required className={input} />
          <input aria-label="Description" name="description" placeholder="Description" className={input} />
          <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Ajouter
          </SubmitButton>
        </form>
        <div className="overflow-x-auto">
        <table aria-label="Catégories de frais" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Code</th>
              <th scope="col" className="py-2">Libellé</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">{cat.code}</td>
                <td className="py-2">{cat.label}</td>
                <td className="py-2">{cat.status === "ACTIVE" ? "Actif" : "Archivé"}</td>
                <td className="py-2 text-right">
                  {cat.status === "ACTIVE" ? (
                    <Link
                      href={`/app/fees/settings?confirm=archive-category&id=${cat.id}`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Archiver
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-zinc-900">Tarifs</div>
          <form method="GET">
            <select
                  aria-label="Année scolaire" name="year" defaultValue={yearId ?? ""} className={input} onChange={undefined}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.name}</option>
              ))}
            </select>
            <button type="submit" className="ml-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm">
              Afficher
            </button>
          </form>
        </div>

        {canManage && yearId ? (
          <form action={createTariffAction} className="mb-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="academicYearId" value={yearId} />
            <select
                  aria-label="Catégorie" name="categoryId" required className={input}>
              <option value="">Catégorie…</option>
              {categories.filter((cc) => cc.status === "ACTIVE").map((cc) => (
                <option key={cc.id} value={cc.id}>{cc.label}</option>
              ))}
            </select>
            <select
                  aria-label="Tous niveaux" name="levelId" className={input}>
              <option value="">Tous niveaux</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <select
                  aria-label="Toutes classes" name="classroomId" className={input}>
              <option value="">Toutes classes</option>
              {classrooms.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
            <input aria-label="Montant" name="amount" type="number" min="0" placeholder="Montant FCFA" required className={input} />
            <select
                  aria-label="Plan de paiement" name="paymentPlan" className={input}>
              <option value="SINGLE">Paiement unique</option>
              <option value="INSTALLMENTS">Échelonné</option>
            </select>
            <input name="installmentCount" type="number" min="1" max="12" defaultValue="1" title="Nb échéances" className={input} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="mandatory" defaultChecked /> Obligatoire
            </label>
            <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              Ajouter le tarif
            </SubmitButton>
          </form>
        ) : null}

        <div className="overflow-x-auto">
        <table aria-label="Tarifs" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Catégorie</th>
              <th scope="col" className="py-2">Niveau</th>
              <th scope="col" className="py-2">Classe</th>
              <th scope="col" className="py-2 text-right">Montant</th>
              <th scope="col" className="py-2">Échéances</th>
              <th scope="col" className="py-2">Portée</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{t.category.label}</td>
                <td className="py-2">{t.level?.name ?? "—"}</td>
                <td className="py-2">{t.classroom?.name ?? "—"}</td>
                <td className="py-2 text-right font-medium">{fmt(t.amount)}</td>
                <td className="py-2">{t.paymentPlan === "INSTALLMENTS" ? `${t.installmentCount}×` : "Unique"}</td>
                <td className="py-2">{t.mandatory ? "Obligatoire" : "Facultatif"}</td>
                <td className="py-2">{t.status === "ACTIVE" ? "Actif" : "Archivé"}</td>
                <td className="py-2 text-right">
                  {canManage && t.status === "ACTIVE" ? (
                    <form action={updateTariffAmountAction} className="flex flex-wrap items-center justify-end gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input aria-label="Montant" name="amount" type="number" min="0" placeholder="Nouveau montant" className="w-32 rounded-lg border border-zinc-300 px-2 py-1 text-xs" />
                      <SubmitButton className="text-xs text-zinc-600 hover:underline" title="Crée une nouvelle version du tarif (l'ancien est archivé)">
                        Réviser
                      </SubmitButton>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {tariffs.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-zinc-500">Aucun tarif pour cette année.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Réviser un montant archive l&apos;ancien tarif : l&apos;historique est conservé et les créances déjà générées ne changent pas.
        </p>
      </div>
    </div>
  );
}
