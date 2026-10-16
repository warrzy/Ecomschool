import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getClassroom, listLevels } from "@/lib/services/classes";
import { updateClassroomAction } from "@/app/app/(tenant)/classrooms/actions";
import {
  removeClassroomSubjectAction,
  setClassroomSubjectAction,
} from "@/app/app/(tenant)/subjects/actions";
import {
  getWeekTimetable,
  weekStart,
  minutesToLabel,
} from "@/lib/services/schedules";
import { listAttendance, classroomStats } from "@/lib/services/attendance";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

const SESS_LABEL: Record<string, string> = {
  PLANNED: "Prévue",
  DONE: "Réalisée",
  CANCELLED: "Annulée",
  POSTPONED: "Reportée",
};

export const instant = false;

const TABS = [
  { key: "general", label: "Vue générale" },
  { key: "students", label: "Élèves" },
  { key: "teachers", label: "Enseignants" },
  { key: "subjects", label: "Matières" },
  { key: "timetable", label: "Emploi du temps" },
  { key: "sessions", label: "Cours" },
  { key: "absences", label: "Absences" },
  { key: "stats", label: "Statistiques" },
  { key: "grades", label: "Notes" },
  { key: "results", label: "Résultats" },
  { key: "report-cards", label: "Bulletins" },
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
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmLinkId = typeof sp.link === "string" ? sp.link : undefined;

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

  const canViewTimetable = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.read",
  });
  const canPrint = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.print",
  });
  const canViewAttendance = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "attendance.read",
  });
  const canViewGrades = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "grades.read",
  });
  const canViewResults = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "results.read",
  });
  const canViewCards = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "reportcards.read",
  });

  const [levels, teachers, enrollments, classSubjects, classTeachers, allSubjects, ttSlots, classSessions, classAbsences, stats, classAssessments, classResults, classCards] = await Promise.all([
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
    activeTab === "subjects"
      ? prisma.classroomSubject.findMany({
          where: { classroomId: id },
          orderBy: { subject: { name: "asc" } },
          select: {
            id: true,
            coefficient: true,
            subject: { select: { id: true, name: true, code: true } },
            teacher: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        })
      : Promise.resolve([]),
    activeTab === "teachers"
      ? prisma.teachingAssignment.findMany({
          where: { classroomId: id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            teacher: {
              select: { id: true, firstName: true, lastName: true },
            },
            subject: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    activeTab === "subjects"
      ? prisma.subject.findMany({
          where: { schoolId: tenant.schoolId, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    activeTab === "timetable" && canViewTimetable
      ? getWeekTimetable(
          { schoolId: tenant.schoolId },
          { weekStart: weekStart(new Date()), classroomId: id },
        )
      : Promise.resolve([]),
    activeTab === "sessions"
      ? prisma.courseSession.findMany({
          where: { classroomId: id, schoolId: tenant.schoolId },
          orderBy: [{ date: "desc" }, { startMin: "desc" }],
          take: 100,
          select: {
            id: true,
            date: true,
            startMin: true,
            endMin: true,
            status: true,
            cancellationReason: true,
            subject: { select: { name: true } },
            teacher: { select: { firstName: true, lastName: true } },
            room: { select: { name: true } },
            content: { select: { id: true } },
            _count: { select: { attendance: true } },
          },
        })
      : Promise.resolve([]),
    activeTab === "absences" && canViewAttendance
      ? listAttendance(ctx, { classroomId: id, pageSize: 100 })
      : Promise.resolve(null),
    activeTab === "stats"
      ? classroomStats(ctx, id)
      : Promise.resolve(null),
    activeTab === "grades" && canViewGrades
      ? prisma.assessment.findMany({
          where: { schoolId: tenant.schoolId, classroomId: id },
          include: {
            subject: { select: { name: true } },
            type: { select: { name: true } },
            academicPeriod: { select: { name: true } },
            _count: { select: { grades: true } },
          },
          orderBy: { date: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    activeTab === "results" && canViewResults
      ? prisma.studentPeriodResult.findMany({
          where: { schoolId: tenant.schoolId, classroomId: id },
          include: {
            student: { select: { matricule: true, firstName: true, lastName: true } },
            academicPeriod: { select: { name: true, number: true } },
          },
          orderBy: [{ academicPeriod: { number: "desc" } }, { rank: "asc" }],
          take: 200,
        })
      : Promise.resolve([]),
    activeTab === "report-cards" && canViewCards
      ? prisma.reportCard.findMany({
          where: { schoolId: tenant.schoolId, classroomId: id },
          include: {
            student: { select: { matricule: true, firstName: true, lastName: true } },
            academicPeriod: { select: { name: true, number: true } },
          },
          orderBy: [{ academicPeriod: { number: "desc" } }, { student: { lastName: "asc" } }],
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  const confirmSubject = classSubjects.find((cs) => cs.id === confirmLinkId);
  const selfHref = `/app/classrooms/${id}?tab=subjects`;

  return (
    <div className="space-y-4">
      {canManage && confirm === "remove-subject" && confirmSubject ? (
        <ConfirmPanel
          title="Confirmer le retrait de la matière"
          action={removeClassroomSubjectAction}
          fields={{ linkId: confirmSubject.id, returnTo: selfHref }}
          confirmLabel="Retirer la matière"
          cancelHref={selfHref}
        >
          Retirer <strong>{confirmSubject.subject.name}</strong> (coef{" "}
          {confirmSubject.coefficient}) de la classe{" "}
          <strong>{classroom.name}</strong> la fait disparaître des calculs et
          emplois du temps de cette classe. Réversible en réaffectant la
          matière.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Classe</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {classroom.name}
            </h1>
            <div className="mt-1 text-sm text-zinc-600">
              Niveau {classroom.level.name} · Année{" "}
              {classroom.academicYear.name}
              {classroom.academicYear.isCurrent ? " (courante)" : ""} ·{" "}
              {statusLabel("classroom", classroom.status)}
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
            <table aria-label="Élèves inscrits" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Matricule</th>
                  <th scope="col" className="py-2 pr-4">Nom</th>
                  <th scope="col" className="py-2 pr-4">Prénom</th>
                  <th scope="col" className="py-2 pr-4">Sexe</th>
                  <th scope="col" className="py-2 pr-4">Inscrit le</th>
                  <th scope="col" className="py-2 pr-4"></th>
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
      ) : activeTab === "subjects" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Matières de la classe ({classSubjects.length})
          </div>
          <div className="overflow-x-auto">
            <table aria-label="Matières de la classe" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Matière</th>
                  <th scope="col" className="py-2 pr-4">Coefficient</th>
                  <th scope="col" className="py-2 pr-4">Enseignant</th>
                  {canManage ? <th scope="col" className="py-2 pr-4"></th> : null}
                </tr>
              </thead>
              <tbody>
                {classSubjects.map((cs) => (
                  <tr key={cs.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 font-medium text-zinc-900">
                      {cs.subject.name}
                      {cs.subject.code ? (
                        <span className="text-zinc-500">
                          {" "}
                          ({cs.subject.code})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {cs.coefficient}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {cs.teacher
                        ? `${cs.teacher.lastName} ${cs.teacher.firstName}`
                        : "—"}
                    </td>
                    {canManage ? (
                      <td className="py-2 pr-4">
                        <Link
                          href={`${selfHref}&confirm=remove-subject&link=${cs.id}`}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Retirer
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {classSubjects.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={4}>
                      Aucune matière affectée à cette classe.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={setClassroomSubjectAction} className="mt-4">
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <input type="hidden" name="classroomId" value={id} />
              <input
                type="hidden"
                name="returnTo"
                value={`/app/classrooms/${id}?tab=subjects`}
              />
              <div className="grid items-end gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-1">
                    Matière
                  </label>
                  <select id="fld-src-app-app-tenant-classrooms-id-page-ts-1"
                    name="subjectId"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="">Choisir…</option>
                    {allSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-2">
                    Coefficient
                  </label>
                  <input id="fld-src-app-app-tenant-classrooms-id-page-ts-2"
                    name="coefficient"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-3">
                    Enseignant
                  </label>
                  <select id="fld-src-app-app-tenant-classrooms-id-page-ts-3"
                    name="teacherId"
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="">—</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.lastName} {t.firstName}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Affecter
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Réaffecter une matière existante met à jour son coefficient et
                son enseignant.
              </p>
            </form>
          ) : null}
        </div>
      ) : activeTab === "teachers" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Enseignants affectés ({classTeachers.length})
          </div>
          <div className="overflow-x-auto">
            <table aria-label="Enseignants affectés" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Enseignant</th>
                  <th scope="col" className="py-2 pr-4">Matière</th>
                </tr>
              </thead>
              <tbody>
                {classTeachers.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 text-zinc-900">
                      <Link
                        href={`/app/teachers/${a.teacher.id}`}
                        className="hover:underline"
                      >
                        {a.teacher.lastName} {a.teacher.firstName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {a.subject?.name ?? "—"}
                    </td>
                  </tr>
                ))}
                {classTeachers.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={2}>
                      Aucune affectation. L&apos;affectation des enseignants se
                      fait depuis la fiche enseignant.
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
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <input type="hidden" name="id" value={classroom.id} />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-4">
                    Nom
                  </label>
                  <input id="fld-src-app-app-tenant-classrooms-id-page-ts-4"
                    name="name"
                    defaultValue={classroom.name}
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-5">
                    Niveau
                  </label>
                  <select id="fld-src-app-app-tenant-classrooms-id-page-ts-5"
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
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-6">
                    Section
                  </label>
                  <input id="fld-src-app-app-tenant-classrooms-id-page-ts-6"
                    name="section"
                    defaultValue={classroom.section ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-7">
                    Capacité
                  </label>
                  <input id="fld-src-app-app-tenant-classrooms-id-page-ts-7"
                    name="capacity"
                    type="number"
                    min={0}
                    defaultValue={classroom.capacity ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-8">
                    Salle
                  </label>
                  <input id="fld-src-app-app-tenant-classrooms-id-page-ts-8"
                    name="room"
                    defaultValue={classroom.room ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-9">
                    Professeur principal
                  </label>
                  <select id="fld-src-app-app-tenant-classrooms-id-page-ts-9"
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
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-classrooms-id-page-ts-10">
                    Statut
                  </label>
                  <select id="fld-src-app-app-tenant-classrooms-id-page-ts-10"
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
      ) : activeTab === "timetable" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-900">
              Emploi du temps — semaine en cours
            </div>
            <div className="flex gap-2 text-sm">
              <Link
                href={`/app/schedules?view=classroom&id=${id}`}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
              >
                Vue complète
              </Link>
              {canPrint ? (
                <a
                  href={`/app/schedules/pdf?view=classroom&id=${id}`}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800"
                >
                  Exporter PDF
                </a>
              ) : null}
            </div>
          </div>
          {ttSlots.length === 0 ? (
            <p className="text-sm text-zinc-600">
              Aucun cours planifié cette semaine.{" "}
              <Link
                href={`/app/schedules?view=classroom&id=${id}`}
                className="underline"
              >
                Ajouter un créneau
              </Link>
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {ttSlots.map((s) => (
                <li
                  key={`${s.source}-${s.id}`}
                  className={`flex items-center justify-between rounded-xl border border-zinc-100 px-3 py-2 ${s.status === "CANCELLED" ? "opacity-50 line-through" : ""}`}
                >
                  <span className="font-medium text-zinc-900">
                    {s.subjectName ?? "Cours"}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {DAY_LABEL[s.weekday]} · {minutesToLabel(s.startMin)}–
                    {minutesToLabel(s.endMin)} · {s.teacherName}
                    {s.roomName ? ` · ${s.roomName}` : ""}
                    {s.status === "CANCELLED"
                      ? " · ANNULÉ"
                      : s.status === "POSTPONED"
                        ? " · REPORTÉ"
                        : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : activeTab === "sessions" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Séances ({classSessions.length})
          </div>
          <div className="overflow-x-auto">
            <table aria-label="Séances" className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Date</th>
                  <th scope="col" className="py-2 pr-4">Horaire</th>
                  <th scope="col" className="py-2 pr-4">Matière</th>
                  <th scope="col" className="py-2 pr-4">Enseignant</th>
                  <th scope="col" className="py-2 pr-4">Salle</th>
                  <th scope="col" className="py-2 pr-4">Statut</th>
                  <th scope="col" className="py-2 pr-4">Appel</th>
                  <th scope="col" className="py-2 pr-4">Cahier</th>
                  <th scope="col" className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {classSessions.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 text-zinc-700">
                      {s.date.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {minutesToLabel(s.startMin)}–{minutesToLabel(s.endMin)}
                    </td>
                    <td className="py-2 pr-4 font-medium text-zinc-900">
                      {s.subject?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {s.teacher.lastName} {s.teacher.firstName}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {s.room?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {SESS_LABEL[s.status] ?? s.status}
                      {s.cancellationReason ? (
                        <span className="text-xs text-zinc-500">
                          {" "}
                          ({s.cancellationReason})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {s._count.attendance > 0
                        ? `${s._count.attendance} marque(s)`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">
                      {s.content ? "Renseigné" : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/app/sessions/${s.id}`}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
                {classSessions.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={9}>
                      Aucune séance. Les séances se créent depuis
                      l&#8217;emploi du temps (clic sur un créneau) ou en
                      séance ponctuelle.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "absences" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Absences et retards des élèves ({classAbsences?.total ?? 0})
          </div>
          {!classAbsences || classAbsences.items.length === 0 ? (
            <p className="text-sm text-zinc-600">Aucun enregistrement.</p>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="Absences et retards des élèves" className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th scope="col" className="py-2 pr-4">Date</th>
                    <th scope="col" className="py-2 pr-4">Élève</th>
                    <th scope="col" className="py-2 pr-4">Type</th>
                    <th scope="col" className="py-2 pr-4">Détails</th>
                    <th scope="col" className="py-2 pr-4">Justification</th>
                  </tr>
                </thead>
                <tbody>
                  {classAbsences.items.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100">
                      <td className="py-2 pr-4 text-zinc-700">
                        {r.date.toISOString().slice(0, 10)}
                      </td>
                      <td className="py-2 pr-4 text-zinc-900">
                        <Link
                          href={`/app/students/${r.student.id}`}
                          className="hover:underline"
                        >
                          {r.student.lastName} {r.student.firstName}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        {r.status === "ABSENT"
                          ? "Absence"
                          : r.status === "LATE"
                            ? "Retard"
                            : r.status === "EXCUSED"
                              ? "Excusé"
                              : r.status}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        {r.status === "LATE" && r.durationMin != null
                          ? `${r.durationMin} min`
                          : r.session?.subject?.name ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        {r.justification ?? (r.justifiedAt ? "Justifiée" : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeTab === "stats" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Statistiques</div>
          {stats ? (
            <div className="mt-4 grid gap-4 md:grid-cols-5">
              {[
                { label: "Cours prévus", value: stats.planned },
                { label: "Cours réalisés", value: stats.done },
                { label: "Cours annulés", value: stats.cancelled },
                {
                  label: "Taux de présence",
                  value:
                    stats.attendanceRate != null
                      ? `${Math.round(stats.attendanceRate * 100)} %`
                      : "—",
                },
                { label: "Retards", value: stats.lates },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-zinc-100 p-4"
                >
                  <div className="text-xs text-zinc-500">{kpi.label}</div>
                  <div className="mt-1 text-2xl font-semibold text-zinc-900">
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : activeTab === "grades" && canViewGrades ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Évaluations de la classe
          </div>
          {classAssessments.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Aucune évaluation.</p>
          ) : (
            <table aria-label="Émargements" className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Date</th>
                  <th scope="col" className="py-2 pr-4">Titre</th>
                  <th scope="col" className="py-2 pr-4">Matière</th>
                  <th scope="col" className="py-2 pr-4">Type</th>
                  <th scope="col" className="py-2 pr-4">Période</th>
                  <th scope="col" className="py-2 pr-4">Notes</th>
                  <th scope="col" className="py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {classAssessments.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4">{a.date.toLocaleDateString("fr-FR")}</td>
                    <td className="py-2 pr-4">
                      <Link href={`/app/grades/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{a.subject.name}</td>
                    <td className="py-2 pr-4">{a.type.name}</td>
                    <td className="py-2 pr-4">{a.academicPeriod?.name ?? "—"}</td>
                    <td className="py-2 pr-4">{a._count.grades}</td>
                    <td className="py-2">{statusLabel("assessment", a.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : activeTab === "results" && canViewResults ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-900">
              Résultats et classements
            </div>
            <Link
              href={`/app/averages?classroom=${id}`}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Calculer les moyennes
            </Link>
          </div>
          {classResults.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucun résultat calculé — lancez le calcul depuis « Résultats »
              en choisissant la période.
            </p>
          ) : (
            <table aria-label="Évaluations de la classe" className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Période</th>
                  <th scope="col" className="py-2 pr-4">Rang</th>
                  <th scope="col" className="py-2 pr-4">Matricule</th>
                  <th scope="col" className="py-2 pr-4">Élève</th>
                  <th scope="col" className="py-2 pr-4">Moyenne</th>
                  <th scope="col" className="py-2 pr-4">Mention</th>
                  <th scope="col" className="py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {classResults.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4">{r.academicPeriod.name}</td>
                    <td className="py-2 pr-4">{r.rank ?? "—"}</td>
                    <td className="py-2 pr-4 text-zinc-500">{r.student.matricule}</td>
                    <td className="py-2 pr-4 font-medium">
                      {r.student.lastName} {r.student.firstName}
                    </td>
                    <td className="py-2 pr-4">
                      {r.generalAverage != null ? `${r.generalAverage.toFixed(2)}/20` : "—"}
                    </td>
                    <td className="py-2 pr-4">{r.mention ?? "—"}</td>
                    <td className="py-2">{statusLabel("result", r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : activeTab === "report-cards" && canViewCards ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-900">Bulletins de la classe</div>
            <Link
              href={`/app/report-cards?classroom=${id}`}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Gérer les bulletins
            </Link>
          </div>
          {classCards.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucun bulletin — générez-les depuis la page Bulletins après calcul des moyennes.
            </p>
          ) : (
            <table aria-label="Récapitulatif" className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                  <th scope="col" className="py-2 pr-4">Période</th>
                  <th scope="col" className="py-2 pr-4">Identifiant</th>
                  <th scope="col" className="py-2 pr-4">Élève</th>
                  <th scope="col" className="py-2 pr-4">Version</th>
                  <th scope="col" className="py-2 pr-4">Statut</th>
                  <th scope="col" className="py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {classCards.map((card) => (
                  <tr key={card.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-4">{card.academicPeriod.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{card.identifier}</td>
                    <td className="py-2 pr-4 font-medium">
                      {card.student.lastName} {card.student.firstName}
                    </td>
                    <td className="py-2 pr-4">v{card.currentVersion}</td>
                    <td className="py-2 pr-4">
                      {statusLabel("reportCard", card.status)}
                    </td>
                    <td className="py-2">
                      <a
                        href={`/app/report-cards/pdf?id=${card.id}`}
                        target="_blank"
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                      >
                        Ouvrir
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
