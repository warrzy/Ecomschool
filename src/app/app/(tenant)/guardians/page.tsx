import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listGuardians } from "@/lib/services/guardians";
import { createGuardianAction } from "@/app/app/(tenant)/guardians/actions";

export const instant = false;

export default async function GuardiansPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("guardian.read");
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
    permissionKey: "guardian.manage",
  });

  const { items, total, pageSize } = await listGuardians(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { status, q, page },
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (status === "ARCHIVED") params.set("status", "ARCHIVED");
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/app/guardians${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Parents &amp; tuteurs
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
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
              placeholder="Nom, téléphone, email…"
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

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Nouveau parent/tuteur
          </div>
          <form action={createGuardianAction} className="mt-4">
            <div className="grid items-end gap-4 md:grid-cols-6">
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
                <label className="text-sm font-medium text-zinc-800">
                  Téléphone
                </label>
                <input
                  name="phone"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Adresse
                </label>
                <input
                  name="address"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Créer
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm text-zinc-600">
          {total} parent{total > 1 ? "s/tuteurs" : "/tuteur"} — page {page}/
          {totalPages}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Téléphone</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Enfants rattachés</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {g.lastName} {g.firstName}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{g.phone ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{g.email ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {g._count.students}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{g.status}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/guardians/${g.id}`}
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
                    Aucun parent/tuteur
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="mt-4 flex items-center gap-2 text-sm">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
              >
                ← Précédent
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
              >
                Suivant →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
