import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listSubjects } from "@/lib/services/subjects";
import { createSubjectAction } from "@/app/app/(tenant)/subjects/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";

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
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Matières
        </div>
        <div className="mt-1 text-sm text-zinc-600">
          Les coefficients se définissent par niveau et par classe depuis la
          fiche matière.
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              Recherche
            </label>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nom, code…"
              className="h-10 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Statut</label>
            <select
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
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
          >
            Filtrer
          </button>
        </form>
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Nouvelle matière
          </div>
          <form
            action={createSubjectAction}
            className="mt-4 flex flex-wrap items-end gap-4"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Nom</label>
              <input
                name="name"
                placeholder="Mathématiques"
                required
                className="h-11 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Code</label>
              <input
                name="code"
                placeholder="MATH"
                className="h-11 w-32 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Créer
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm text-zinc-600">
          {total} matière{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Niveaux</th>
                <th className="py-2 pr-4">Classes</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4"></th>
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
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
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
