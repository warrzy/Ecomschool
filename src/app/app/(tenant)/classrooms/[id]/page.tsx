import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getClassroom, listLevels } from "@/lib/services/classes";
import { updateClassroomAction } from "@/app/app/(tenant)/classrooms/actions";

export const instant = false;

const TABS = [
  { key: "general", label: "Vue générale" },
  { key: "students", label: "Élèves" },
  { key: "teachers", label: "Enseignants" },
  { key: "subjects", label: "Matières" },
  { key: "timetable", label: "Emploi du temps" },
  { key: "grades", label: "Notes" },
  { key: "results", label: "Résultats" },
  { key: "report-cards", label: "Bulletins" },
  { key: "absences", label: "Absences" },
] as const;

function PlannedTab({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
      <div className="text-sm font-medium text-zinc-800">
        Onglet « {label} » non développé
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Ce contenu sera implémenté dans un module suivant (élèves,
        enseignants, matières, emploi du temps, notes, absences). Aucune
        donnée fictive n&apos;est affichée.
      </p>
    </div>
  );
}

export default async function ClassroomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("classroom.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const tab = typeof sp.tab === "string" ? sp.tab : "general";
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const classroom = await getClassroom(ctx, id);
  if (!classroom) notFound();

  const canManage =
    classroom.academicYear.status !== "CLOSED" &&
    (await userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "classroom.manage",
    }));

  const activeTab = TABS.some((t) => t.key === tab) ? tab : "general";

  const [levels, teachers, enrollments] = await Promise.all([
    listLevels(ctx),
    prisma.teacher.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    activeTab === "students"
      ? prisma.enrollment.findMany({
          where: { classroomId: id, status: "ENROLLED" },
          orderBy: { enrolledAt: "asc" },
          select: {
            id: true,
            enrolledAt: true,
            student: {
              select: {
                id: true,
                matricule: true,
                firstName: true,
                lastName: true,
                sex: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Classe</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {classroom.name}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              Niveau {classroom.level.name} · Année{" "}
              {classroom.academicYear.name}
              {classroom.academicYear.isCurrent ? " (courante)" : ""} ·{" "}
              {classroom.status}
            </div>
          </div>
          <Link
            href="/app/classrooms"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retour
          </Link>
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

      <div className="flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/classrooms/${id}?tab=${t.key}`}
            className={`rounded-xl px-3 py-1.5 text-sm ${
              activeTab === t.key
                ? "bg-zinc-900 font-medium text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "students" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            {enrollments.length} élève{enrollments.length > 1 ? "s" : ""}{" "}
            inscrit{enrollments.length > 1 ? "s" : ""}
            {classroom.capacity
              ? ` / capacité ${classroom.capacity}`
              : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="py-2 pr-4">Matricule</th>
                  <th className="py-2 pr-4">Nom</th>
                  <th className="py-2 pr-4">Prénom</th>
                  <th className="py-2 pr-4">Sexe</th>
                  <th className="py-2 pr-4">Inscrit le</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 font-medium text-zinc-900">
                      {e.student.matricule}
                    </td>
                    <td className="py-2 pr-4 text-zinc-900">
                      {e.student.lastName}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {e.student.firstName}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {e.student.sex === "MALE"
                        ? "M"
                        : e.student.sex === "FEMALE"
                          ? "F"
                          : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {e.enrolledAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/app/students/${e.student.id}`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      >
                        Fiche
                      </Link>
                    </td>
                  </tr>
                ))}
                {enrollments.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={6}>
                      Aucun élève inscrit dans cette classe.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "general" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          {canManage ? (
            <form action={updateClassroomAction}>
              <input type="hidden" name="id" value={classroom.id} />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Nom
                  </label>
                  <input
                    name="name"
                    defaultValue={classroom.name}
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Niveau
                  </label>
                  <select
                    name="levelId"
                    defaultValue={classroom.level.id}
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
                  <label className="text-sm font-medium text-zinc-800">
                    Section
                  </label>
                  <input
                    name="section"
                    defaultValue={classroom.section ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Capacité
                  </label>
                  <input
                    name="capacity"
                    type="number"
                    min={0}
                    defaultValue={classroom.capacity ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Salle
                  </label>
                  <input
                    name="room"
                    defaultValue={classroom.room ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Professeur principal
                  </label>
                  <select
                    name="headTeacherId"
                    defaultValue={classroom.headTeacher?.id ?? ""}
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
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">
                    Statut
                  </label>
                  <select
                    name="status"
                    defaultValue={classroom.status}
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Enregistrer
              </button>
            </form>
          ) : (
            <dl className="grid gap-4 md:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-zinc-500">Nom</dt>
                <dd className="mt-1 text-sm text-zinc-900">{classroom.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Niveau</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {classroom.level.name}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Section</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {classroom.section ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Capacité</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {classroom.capacity ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Salle</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {classroom.room ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">
                  Professeur principal
                </dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {classroom.headTeacher
                    ? `${classroom.headTeacher.lastName} ${classroom.headTeacher.firstName}`
                    : "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>
      ) : (
        <PlannedTab
          label={TABS.find((t) => t.key === activeTab)?.label ?? activeTab}
        />
      )}
    </div>
  );
}
