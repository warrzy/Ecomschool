import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listYears } from "@/lib/services/academic";
import {
  closeYearAction,
  createYearAction,
  setCurrentYearAction,
} from "@/app/app/(tenant)/academic-years/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

const d = (v: Date) => v.toISOString().slice(0, 10);

export default async function AcademicYearsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("academic.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "academic.manage",
  });

  const years = await listYears({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
  });
  const confirmTarget = years.find((y) => y.id === confirmId);

  return (
    <div className="space-y-4">
      {canManage && confirm === "current" && confirmTarget ? (
        <ConfirmPanel
          title="Confirmer le changement d'année courante"
          action={setCurrentYearAction}
          fields={{ id: confirmTarget.id }}
          confirmLabel="Définir comme année courante"
          cancelHref="/app/academic-years"
        >
          Définir <strong>{confirmTarget.name}</strong> comme année courante
          change le contexte de toute l&apos;école : les listes, saisies et
          finances basculeront sur cette année. L&apos;opération est réversible
          mais impacte immédiatement tous les utilisateurs.
        </ConfirmPanel>
      ) : null}
      {canManage && confirm === "close" && confirmTarget ? (
        <ConfirmPanel
          title="Confirmer la clôture de l'année"
          tone="danger"
          action={closeYearAction}
          fields={{ id: confirmTarget.id }}
          confirmLabel="Clôturer définitivement"
          cancelHref="/app/academic-years"
        >
          Clôturer <strong>{confirmTarget.name}</strong> verrouille
          définitivement ses inscriptions, notes, évaluations et périodes.{" "}
          <strong>Cette action est irréversible</strong> : aucune réouverture
          n&apos;est possible depuis l&apos;interface.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Années scolaires
        </h1>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">
            Nouvelle année scolaire
          </div>
          <form action={createYearAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-academic-years-page-t-1">Nom</label>
                <input id="fld-src-app-app-tenant-academic-years-page-t-1"
                  name="name"
                  placeholder="2026-2027"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-academic-years-page-t-2">Début</label>
                <input id="fld-src-app-app-tenant-academic-years-page-t-2"
                  name="startDate"
                  type="date"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-academic-years-page-t-3">Fin</label>
                <input id="fld-src-app-app-tenant-academic-years-page-t-3"
                  name="endDate"
                  type="date"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-academic-years-page-t-4">
                  Découpage
                </label>
                <select id="fld-src-app-app-tenant-academic-years-page-t-4"
                  name="periodType"
                  defaultValue="TRIMESTER"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none"
                >
                  <option value="TRIMESTER">Trimestres</option>
                  <option value="SEMESTER">Semestres</option>
                </select>
              </div>
              <label className="flex flex-wrap items-center gap-2 pt-6 text-sm text-zinc-800">
                <input type="checkbox" name="isCurrent" />
                Définir comme année courante
              </label>
            </div>
            <button
              type="submit"
              className="mt-4 h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              Créer
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="overflow-x-auto">
          <table aria-label="Années scolaires" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Début</th>
                <th scope="col" className="py-2 pr-4">Fin</th>
                <th scope="col" className="py-2 pr-4">Périodes</th>
                <th scope="col" className="py-2 pr-4">Courante</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                <th scope="col" className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {y.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{d(y.startDate)}</td>
                  <td className="py-2 pr-4 text-zinc-700">{d(y.endDate)}</td>
                  <td className="py-2 pr-4 text-zinc-700">{y._count.periods}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {y.isCurrent ? "Oui" : "Non"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {statusLabel("academicYear", y.status)}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/app/academic-years/${y.id}/periods`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                      >
                        Périodes
                      </Link>
                      {canManage && !y.isCurrent && y.status !== "CLOSED" ? (
                        <Link
                          href={`/app/academic-years?confirm=current&id=${y.id}`}
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                        >
                          Définir courante
                        </Link>
                      ) : null}
                      {canManage && !y.isCurrent && y.status === "ACTIVE" ? (
                        <Link
                          href={`/app/academic-years?confirm=close&id=${y.id}`}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                        >
                          Clôturer
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {years.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={7}>
                    Aucune année scolaire
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
