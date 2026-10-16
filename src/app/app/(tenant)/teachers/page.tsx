import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listTeachers } from "@/lib/services/teachers";
import { createTeacherAction } from "@/app/app/(tenant)/teachers/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";

export const instant = false;

export default async function TeachersPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("teacher.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const status =
    sp.status === "ARCHIVED" ? ("ARCHIVED" as const) : ("ACTIVE" as const);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const [canManage, canReadUsers] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "teacher.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "user.read",
    }),
  ]);

  const [{ items, total, pageSize }, years] = await Promise.all([
    listTeachers(
      { userId: tenant.userId, schoolId: tenant.schoolId },
      { status, q, page },
    ),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (status === "ARCHIVED") params.set("status", "ARCHIVED");
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/app/teachers${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Enseignants
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
              placeholder="Nom, prénom, email…"
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
              <option value="ACTIVE">Actifs</option>
              <option value="ARCHIVED">Archivés</option>
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

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Exporter les enseignants et affectations
        </div>
        <form
          method="GET"
          action="/app/teachers/export"
          className="flex flex-wrap items-end gap-3"
        >
          <select
            name="year"
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Toutes les années (affectations)</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select
            name="status"
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Tous statuts</option>
            <option value="ACTIVE">Actifs</option>
            <option value="ARCHIVED">Archivés</option>
          </select>
          <select
            name="format"
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
          {canManage ? (
            <label className="flex h-10 items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="full" value="1" />
              Coordonnées incluses
            </label>
          ) : null}
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50"
          >
            Exporter
          </button>
          {canReadUsers ? (
            <>
              <a
                href="/app/users/export?format=csv"
                className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
              >
                Personnel CSV
              </a>
              <a
                href="/app/users/export?format=xlsx"
                className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
              >
                Personnel Excel
              </a>
            </>
          ) : null}
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          L&#8217;export standard ne contient que l&#8217;identité et les affectations.
          Les coordonnées sont réservées aux administrateurs.
        </p>
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Nouvel enseignant
          </div>
          <form
            action={createTeacherAction}
            className="mt-4 grid items-end gap-4 md:grid-cols-5"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Nom</label>
              <input
                name="lastName"
                required
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">
                Prénom
              </label>
              <input
                name="firstName"
                required
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Email</label>
              <input
                name="email"
                type="email"
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">
                Téléphone
              </label>
              <input
                name="phone"
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
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
          {total} enseignant{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Téléphone</th>
                <th className="py-2 pr-4">Affectations</th>
                <th className="py-2 pr-4">PP</th>
                <th className="py-2 pr-4">Compte</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {t.lastName} {t.firstName}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{t.email ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{t.phone ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {t._count.assignments}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {t._count.headOfClassrooms}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {t.userId ? "Activé" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("teacher", t.status)}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/teachers/${t.id}`}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                    >
                      Fiche
                    </Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={8}>
                    Aucun enseignant
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="mt-4 flex items-center gap-2 text-sm">
            {page > 1 ? (
              <a
                href={pageHref(page - 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
              >
                ← Précédent
              </a>
            ) : null}
            {page < totalPages ? (
              <a
                href={pageHref(page + 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
              >
                Suivant →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
