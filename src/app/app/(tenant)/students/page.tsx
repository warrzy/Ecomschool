import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listStudents } from "@/lib/services/students";
import {
  createStudentAction,
} from "@/app/app/(tenant)/students/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

export default async function StudentsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("student.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const status =
    sp.status === "ARCHIVED"
      ? ("ARCHIVED" as const)
      : sp.status === "ALL"
        ? undefined
        : ("ACTIVE" as const);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const yearId = typeof sp.year === "string" && sp.year ? sp.year : undefined;
  const classroomId =
    typeof sp.classroom === "string" && sp.classroom ? sp.classroom : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const [canManage, canReadEnrollments] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "student.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "enrollment.read",
    }),
  ]);

  const [{ items, total, pageSize }, years, classroomsRaw, selectedClassroom] =
    await Promise.all([
      listStudents(
        { userId: tenant.userId, schoolId: tenant.schoolId },
        { status, q, academicYearId: yearId, classroomId, page },
      ),
      prisma.academicYear.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true },
      }),
      // Les classes proposées sont bornées à l'année choisie ; sans année,
      // toutes les classes de l'établissement restent accessibles.
      prisma.classroom.findMany({
        where: {
          schoolId: tenant.schoolId,
          ...(yearId ? { academicYearId: yearId } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      classroomId
        ? prisma.classroom.findFirst({
            where: { id: classroomId, schoolId: tenant.schoolId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
  // Si la classe sélectionnée n'appartient pas à l'année affichée, on la
  // conserve dans la liste pour que le filtre actif reste visible.
  const classrooms =
    selectedClassroom && !classroomsRaw.some((c) => c.id === classroomId)
      ? [selectedClassroom, ...classroomsRaw]
      : classroomsRaw;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (sp.status) params.set("status", String(sp.status));
    if (q) params.set("q", q);
    if (yearId) params.set("year", yearId);
    if (classroomId) params.set("classroom", classroomId);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/app/students${qs ? `?${qs}` : ""}`;
  };

  const importSummary =
    ok === "import"
      ? `Import : ${sp.created ?? 0} créés, ${sp.updated ?? 0} mis à jour, ${sp.failed ?? 0} en échec`
      : okMessage(ok);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Référentiel</div>
            <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
              Élèves
            </h1>
          </div>
        </div>
        {importSummary ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {importSummary}
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
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-students-page-tsx-1">
              Recherche
            </label>
            <input id="fld-src-app-app-tenant-students-page-tsx-1"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Matricule, nom, prénom…"
              className="h-10 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-students-year">Année scolaire</label>
            <select id="fld-students-year"
              name="year"
              defaultValue={yearId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes les années</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-students-classroom">Classe</label>
            <select id="fld-students-classroom"
              name="classroom"
              defaultValue={classroomId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes les classes</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-students-page-tsx-2">Statut</label>
            <select id="fld-src-app-app-tenant-students-page-tsx-2"
              name="status"
              defaultValue={status ?? "ALL"}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="ALL">Tous</option>
              <option value="ACTIVE">Actifs</option>
              <option value="ARCHIVED">Archivés</option>
            </select>
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
          >
            Filtrer
          </button>
          <Link
            href="/app/students"
            className="flex h-10 items-center rounded-xl px-3 text-sm text-zinc-500 hover:text-zinc-800 hover:bg-mist"
          >
            Réinitialiser
          </Link>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Exporter les élèves et les inscriptions
        </div>
        <form
          method="GET"
          action="/app/students/export"
          className="flex flex-wrap items-end gap-3"
        >
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <select
                  aria-label="Toutes les années"
            name="year"
            defaultValue={yearId ?? ""}
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Toutes les années</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select
                  aria-label="Toutes les classes"
            name="classroom"
            defaultValue={classroomId ?? ""}
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Toutes les classes</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
                  aria-label="Tous statuts"
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Tous statuts</option>
            <option value="ACTIVE">Actifs</option>
            <option value="ARCHIVED">Archivés</option>
          </select>
          <select
                  aria-label="Format d'export"
            name="format"
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
          {canManage ? (
            <label className="flex flex-wrap h-10 items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="full" value="1" />
              Fiche complète
            </label>
          ) : null}
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:bg-mist"
          >
            Exporter la liste
          </button>
          {canReadEnrollments ? (
            <>
              <a
                href="/app/enrollments/export?format=csv"
                className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
              >
                Inscriptions CSV
              </a>
              <a
                href="/app/enrollments/export?format=xlsx"
                className="flex h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm hover:bg-mist"
              >
                Inscriptions Excel
              </a>
            </>
          ) : null}
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          L&#8217;export reprend les filtres actifs (recherche, année, classe,
          statut) et couvre l&#8217;ensemble de la sélection — pas seulement la
          page affichée. L&#8217;export standard ne contient que les données
          pédagogiques (matricule, identité, classe) ; la fiche complète est
          réservée aux administrateurs.
        </p>
      </div>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
            <div className="text-sm font-medium text-zinc-900">
              Nouvel élève
            </div>
            <form action={createStudentAction} className="mt-4">
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-3">
                    Matricule
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-3"
                    name="matricule"
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-4">
                    Sexe
                  </label>
                  <select id="fld-src-app-app-tenant-students-page-tsx-4"
                    name="sex"
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-5">
                    Nom
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-5"
                    name="lastName"
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-6">
                    Prénom
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-6"
                    name="firstName"
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-7">
                    Date de naissance
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-7"
                    name="birthDate"
                    type="date"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-8">
                    Lieu de naissance
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-8"
                    name="birthPlace"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-9">
                    Téléphone
                  </label>
                  <input type="tel" id="fld-src-app-app-tenant-students-page-tsx-9"
                    name="phone"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-10">
                    Email
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-10"
                    name="email"
                    type="email"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-11">
                    Adresse
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-11"
                    name="address"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-page-tsx-12">
                    Photo (URL)
                  </label>
                  <input id="fld-src-app-app-tenant-students-page-tsx-12"
                    name="photoUrl"
                    type="url"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                  />
                </div>
              </div>
              <SubmitButton
                className="mt-4 h-11 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Créer
              </SubmitButton>
            </form>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
            <div className="text-sm font-medium text-zinc-900">
              Importer des élèves
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Assistant CSV/Excel : modèle, analyse sans écriture, aperçu des
              créations/modifications/effacements, puis confirmation explicite.
            </p>
            <Link
              href="/app/students/import"
              className="mt-3 inline-block h-11 rounded-xl border border-zinc-300 px-4 pt-2.5 text-sm font-medium hover:bg-mist"
            >
              Ouvrir l’assistant d’import
            </Link>
            <p className="mt-2 text-xs text-zinc-500">
              Un matricule existant met à jour la fiche ; la colonne « classe »
              inscrit l’élève via les règles d’inscription.
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-3 text-sm text-zinc-600">
          {total} élève{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Élèves" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Matricule</th>
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Prénom</th>
                <th scope="col" className="py-2 pr-4">Sexe</th>
                <th scope="col" className="py-2 pr-4">Naissance</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                <th scope="col" className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {s.matricule}
                  </td>
                  <td className="py-2 pr-4 text-zinc-900">{s.lastName}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.firstName}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {s.sex === "MALE" ? "M" : s.sex === "FEMALE" ? "F" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {s.birthDate
                      ? s.birthDate.toISOString().slice(0, 10)
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{statusLabel("student", s.status)}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/students/${s.id}`}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
                    >
                      Fiche
                    </Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={7}>
                    {q || sp.status || yearId || classroomId ? "Aucun élève ne correspond aux filtres." : "Aucun élève enregistré — créez-le ci-dessus ou via l'import."}
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
