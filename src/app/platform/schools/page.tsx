import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { platformListSchools } from "@/lib/services/schools";
import { setSchoolStatusAction } from "@/app/platform/schools/actions";
import type { SchoolStatus } from "@prisma/client";

export const instant = false;

export default async function PlatformSchoolsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.schools.read");

  const sp = (await props.searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status =
    sp.status === "ACTIVE" || sp.status === "INACTIVE"
      ? (sp.status as SchoolStatus)
      : undefined;
  const page = Number(typeof sp.page === "string" ? sp.page : "1") || 1;

  const { rows: schools, total, pageSize } = await platformListSchools({
    q: q || undefined,
    status,
    page,
  });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("page", String(p));
    return `/platform/schools?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Référentiel</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Établissements
            </div>
          </div>
          <Link
            href="/platform/onboarding"
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Créer un établissement
          </Link>
        </div>

        <form className="mt-4 flex gap-2" action="/platform/schools" method="get">
          <input
            name="q"
            defaultValue={q}
            className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900"
            placeholder="Rechercher (nom, code, ville)"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">Tous statuts</option>
            <option value="ACTIVE">ACTIF</option>
            <option value="INACTIVE">SUSPENDU</option>
          </select>
          <button className="h-11 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Ville</th>
                <th className="py-2 pr-4">Membres</th>
                <th className="py-2 pr-4">Années</th>
                <th className="py-2 pr-4">Statut</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    <Link href={`/platform/schools/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{s.code}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.type ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.city ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s._count.memberships}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s._count.academicYears}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.status}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/platform/schools/${s.id}`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      >
                        Fiche
                      </Link>
                      <form action={setSchoolStatusAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
                        />
                        <button
                          type="submit"
                          className={
                            s.status === "ACTIVE"
                              ? "rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                              : "rounded-lg border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50"
                          }
                        >
                          {s.status === "ACTIVE" ? "Suspendre" : "Activer"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {schools.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={8}>
                    Aucun établissement
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="mt-4 flex items-center gap-2 text-sm">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageLink(p)}
                className={
                  p === page
                    ? "rounded-lg bg-zinc-900 px-3 py-1 text-white"
                    : "rounded-lg border border-zinc-200 px-3 py-1 hover:bg-zinc-50"
                }
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
