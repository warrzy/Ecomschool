import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listSubjects } from "@/lib/services/subjects";
import { createSubjectAction } from "@/app/app/(tenant)/subjects/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";

export const instant = false;

export default async function SubjectsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("subject.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const status =
    sp.status === "ARCHIVED" ? ("ARCHIVED" as const) : ("ACTIVE" as const);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "subject.manage",
  });

  const { items, total, pageSize } = await listSubjects(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { status, q, page },
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Matières
        </h1>
        <div className="mt-1 text-sm text-zinc-600">
          Les coefficients se définissent par niveau et par classe depuis la
          fiche matière.
        </div>
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

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-subjects-page-tsx-1">
              Recherche
            </label>
            <input id="fld-src-app-app-tenant-subjects-page-tsx-1"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nom, code…"
              className="h-10 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-subjects-page-tsx-2">Statut</label>
            <select id="fld-src-app-app-tenant-subjects-page-tsx-2"
              name="status"
              defaultValue={status}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="ACTIVE">Actives</option>
              <option value="ARCHIVED">Archivées</option>
            </select>
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
          >
            Filtrer
          </button>
        </form>
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">
            Nouvelle matière
          </div>
          <form
            action={createSubjectAction}
            className="mt-4 flex flex-wrap items-end gap-4"
          >
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-subjects-page-tsx-3">Nom</label>
              <input id="fld-src-app-app-tenant-subjects-page-tsx-3"
                name="name"
                placeholder="Mathématiques"
                required
                className="h-11 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-subjects-page-tsx-4">Code</label>
              <input id="fld-src-app-app-tenant-subjects-page-tsx-4"
                name="code"
                placeholder="MATH"
                className="h-11 w-32 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              Créer
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-3 text-sm text-zinc-600">
          {total} matière{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Matières" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Code</th>
                <th scope="col" className="py-2 pr-4">Niveaux</th>
                <th scope="col" className="py-2 pr-4">Classes</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                <th scope="col" className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {s.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{s.code ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {s._count.levelAssignments}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {s._count.classAssignments}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("subject", s.status)}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/subjects/${s.id}`}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                    >
                      Fiche
                    </Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={6}>
                    Aucune matière
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
