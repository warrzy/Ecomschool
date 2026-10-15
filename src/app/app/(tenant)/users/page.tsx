import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { listSchoolUsers } from "@/lib/services/users";
import {
  deleteUser,
  resetUserPassword,
} from "@/app/app/(tenant)/users/actions";

export const instant = false;

function safeSort(input: string | undefined) {
  if (input === "email") return "email" as const;
  return "createdAt" as const;
}

function safeDir(input: string | undefined) {
  return input === "asc" ? ("asc" as const) : ("desc" as const);
}

export default async function UsersPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("user.read");

  const sp = (await props.searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const sort = safeSort(typeof sp.sort === "string" ? sp.sort : undefined);
  const dir = safeDir(typeof sp.dir === "string" ? sp.dir : undefined);
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const memberships = await listSchoolUsers(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { q: q || undefined, sort, dir },
  );

  const sortLink = (nextSort: string) => {
    const nextDir = sort === nextSort && dir === "asc" ? "desc" : "asc";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", nextSort);
    params.set("dir", nextDir);
    return `/app/users?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Administration</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Utilisateurs
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/app/users/export?format=csv"
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Exporter CSV
            </a>
            <a
              href="/app/users/export?format=xlsx"
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Exporter Excel
            </a>
            <Link
              href="/app/users/new"
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Nouvel utilisateur
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
        {sp.ok === "reset" ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Lien de réinitialisation émis (valable 24 h) — envoyé par email si le
            canal est configuré.
          </div>
        ) : null}

        <form className="mt-4" action="/app/users" method="get">
          <input
            name="q"
            defaultValue={q}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
            placeholder="Rechercher (email, prénom, nom)"
          />
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">
                  <Link href={sortLink("email")} className="hover:text-zinc-800">
                    Email
                  </Link>
                </th>
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Rôle</th>
                <th className="py-2 pr-4">Membership</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4">
                  <Link
                    href={sortLink("createdAt")}
                    className="hover:text-zinc-800"
                  >
                    Créé le
                  </Link>
                </th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {m.user.email}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {[m.user.firstName, m.user.lastName]
                      .filter(Boolean)
                      .join(" ") || "-"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{m.role.name}</td>
                  <td className="py-2 pr-4 text-zinc-700">{m.status}</td>
                  <td className="py-2 pr-4 text-zinc-700">{m.user.status}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {m.user.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/app/users/${m.user.id}/edit`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      >
                        Modifier
                      </Link>
                      {m.user.id === tenant.userId ? null : (
                        <form action={resetUserPassword}>
                          <input type="hidden" name="id" value={m.user.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                          >
                            Réinit. MDP
                          </button>
                        </form>
                      )}
                      {m.user.id === tenant.userId ? null : (
                        <form action={deleteUser}>
                          <input type="hidden" name="id" value={m.user.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                          >
                            Supprimer
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {memberships.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={7}>
                    Aucun utilisateur
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
