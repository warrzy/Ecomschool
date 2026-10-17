import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listClassrooms, listLevels } from "@/lib/services/classes";
import { createClassroomAction } from "@/app/app/(tenant)/classrooms/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";

export const instant = false;

export default async function ClassroomsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("classroom.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const yearId = typeof sp.year === "string" ? sp.year : undefined;
  const levelId = typeof sp.level === "string" ? sp.level : undefined;
  const status =
    sp.status === "ARCHIVED" ? ("ARCHIVED" as const) : ("ACTIVE" as const);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "classroom.manage",
  });

  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const [{ items, total, pageSize }, levels, years, teachers] =
    await Promise.all([
      listClassrooms(ctx, {
        academicYearId: yearId,
        levelId,
        status,
        q,
        page,
      }),
      listLevels(ctx),
      prisma.academicYear.findMany({
        where: { schoolId: tenant.schoolId, status: { not: "CLOSED" } },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, isCurrent: true },
      }),
      prisma.teacher.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (yearId) params.set("year", yearId);
    if (levelId) params.set("level", levelId);
    if (status === "ARCHIVED") params.set("status", "ARCHIVED");
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/app/classrooms${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Classes
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

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-1">Année</label>
            <select id="fld-src-app-app-tenant-classrooms-page-tsx-1"
              name="year"
              defaultValue={yearId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? " (courante)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-2">Niveau</label>
            <select id="fld-src-app-app-tenant-classrooms-page-tsx-2"
              name="level"
              defaultValue={levelId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Tous</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-3">Statut</label>
            <select id="fld-src-app-app-tenant-classrooms-page-tsx-3"
              name="status"
              defaultValue={status}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="ACTIVE">Actives</option>
              <option value="ARCHIVED">Archivées</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-4">
              Recherche
            </label>
            <input id="fld-src-app-app-tenant-classrooms-page-tsx-4"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nom, section…"
              className="h-10 w-52 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
          >
            Filtrer
          </button>
          <a
            href={`/app/classrooms/export?format=csv${yearId ? `&year=${yearId}` : ""}${levelId ? `&level=${levelId}` : ""}&status=${status}`}
            className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
          >
            Exporter CSV
          </a>
          <a
            href={`/app/classrooms/export?format=xlsx${yearId ? `&year=${yearId}` : ""}${levelId ? `&level=${levelId}` : ""}&status=${status}`}
            className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
          >
            Exporter Excel
          </a>
        </form>
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
          <div className="text-sm font-medium text-zinc-900">
            Nouvelle classe
          </div>
          <form action={createClassroomAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-5">Nom</label>
                <input id="fld-src-app-app-tenant-classrooms-page-tsx-5"
                  name="name"
                  placeholder="6e A"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-6">
                  Année scolaire
                </label>
                <select id="fld-src-app-app-tenant-classrooms-page-tsx-6"
                  name="academicYearId"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                      {y.isCurrent ? " (courante)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-7">
                  Niveau
                </label>
                <select id="fld-src-app-app-tenant-classrooms-page-tsx-7"
                  name="levelId"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-8">
                  Section
                </label>
                <input id="fld-src-app-app-tenant-classrooms-page-tsx-8"
                  name="section"
                  placeholder="A, B, C, D…"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-9">
                  Capacité
                </label>
                <input id="fld-src-app-app-tenant-classrooms-page-tsx-9"
                  name="capacity"
                  type="number"
                  min={0}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-10">Salle</label>
                <input id="fld-src-app-app-tenant-classrooms-page-tsx-10"
                  name="room"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-page-tsx-11">
                  Professeur principal
                </label>
                <select id="fld-src-app-app-tenant-classrooms-page-tsx-11"
                  name="headTeacherId"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">— Aucun —</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lastName} {t.firstName}
                    </option>
                  ))}
                </select>
              </div>
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
        <div className="mb-3 text-sm text-zinc-600">
          {total} classe{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Classes" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Niveau</th>
                <th scope="col" className="py-2 pr-4">Section</th>
                <th scope="col" className="py-2 pr-4">Année</th>
                <th scope="col" className="py-2 pr-4">Capacité</th>
                <th scope="col" className="py-2 pr-4">Salle</th>
                <th scope="col" className="py-2 pr-4">Prof. principal</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                <th scope="col" className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {c.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{c.level.name}</td>
                  <td className="py-2 pr-4 text-zinc-700">{c.section ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {c.academicYear.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {c.capacity ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{c.room ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {c.headTeacher
                      ? `${c.headTeacher.lastName} ${c.headTeacher.firstName}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {statusLabel("classroom", c.status)}
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/classrooms/${c.id}`}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                    >
                      Fiche
                    </Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={9}>
                    {q || levelId ? "Aucune classe ne correspond à la recherche." : "Aucune classe pour cette année — créez-la ci-dessus."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {page > 1 ? (
              <a
                href={pageHref(page - 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-mist"
              >
                ← Précédent
              </a>
            ) : null}
            {page < totalPages ? (
              <a
                href={pageHref(page + 1)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-mist"
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
