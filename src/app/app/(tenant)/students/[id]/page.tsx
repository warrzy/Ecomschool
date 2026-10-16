import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getStudent } from "@/lib/services/students";
import { updateStudentAction } from "@/app/app/(tenant)/students/actions";
import {
  createAndLinkGuardianAction,
  linkGuardianAction,
  unlinkGuardianAction,
} from "@/app/app/(tenant)/guardians/actions";
import {
  getWeekTimetable,
  weekStart,
  minutesToLabel,
} from "@/lib/services/schedules";
import {
  listAttendance,
  studentAttendanceSummary,
} from "@/lib/services/attendance";
import { getStudentAccessStatus } from "@/lib/services/portal/accounts";
import {
  inviteGuardianAction,
  inviteStudentAction,
  resendInviteAction,
  setPortalAccessAction,
} from "@/app/app/(tenant)/students/portal-actions";
import type { AttendanceStatus } from "@prisma/client";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

const ATT_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  LATE: "Retard",
  EXCUSED: "Excusé",
  UNMARKED: "Non renseigné",
};

export const instant = false;

const RELATIONS: Record<string, string> = {
  FATHER: "Père",
  MOTHER: "Mère",
  GUARDIAN: "Tuteur",
  FINANCIAL: "Responsable financier",
  EMERGENCY: "Contact d'urgence",
};

function PendingSection({
  title,
  module,
}: {
  title: string;
  module: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-5">
      <div className="text-sm font-medium text-zinc-800">{title}</div>
      <p className="mt-1 text-sm text-zinc-600">
        Sera disponible avec le module {module}.
      </p>
    </div>
  );
}

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("student.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmLinkId = typeof sp.link === "string" ? sp.link : undefined;

  const student = await getStudent(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!student) notFound();

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "student.manage",
  });
  const canManageGuardians = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "guardian.manage",
  });

  const allGuardians = canManageGuardians
    ? await prisma.guardian.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      })
    : [];

  const canViewTimetable = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.read",
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
  const canViewCards = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "reportcards.read",
  });
  const canPrintCards = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "reportcards.print",
  });
  const canManagePortal = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "portal.manage",
  });
  const access = canManagePortal
    ? await getStudentAccessStatus(
        { userId: tenant.userId, schoolId: tenant.schoolId },
        student.id,
      )
    : null;

  const currentEnrollment =
    student.enrollments.find((e) => e.status === "ENROLLED") ?? null;

  const [weekSlots, attSummary, attList] = await Promise.all([
    canViewTimetable && currentEnrollment
      ? getWeekTimetable(
          { schoolId: tenant.schoolId },
          {
            weekStart: weekStart(new Date()),
            classroomId: currentEnrollment.classroom.id,
          },
        )
      : Promise.resolve([]),
    canViewAttendance
      ? studentAttendanceSummary(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          student.id,
        )
      : Promise.resolve(null),
    canViewAttendance
      ? listAttendance(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          { studentId: student.id, pageSize: 100 },
        )
      : Promise.resolve(null),
  ]);

  const absences = attList?.items.filter((r) => r.status !== "LATE") ?? [];
  const lates = attList?.items.filter((r) => r.status === "LATE") ?? [];

  const [gradeRows, periodResults, reportCards] = await Promise.all([
    canViewGrades
      ? prisma.grade.findMany({
          where: { schoolId: tenant.schoolId, studentId: student.id },
          include: {
            assessment: {
              select: {
                title: true,
                date: true,
                maxScore: true,
                status: true,
                subject: { select: { name: true } },
                type: { select: { name: true } },
                academicPeriod: { select: { name: true } },
              },
            },
          },
          orderBy: { assessment: { date: "desc" } },
          take: 100,
        })
      : Promise.resolve([]),
    canViewGrades
      ? prisma.studentPeriodResult.findMany({
          where: { schoolId: tenant.schoolId, studentId: student.id },
          include: {
            academicPeriod: {
              select: { name: true, academicYear: { select: { name: true } } },
            },
            classroom: { select: { name: true } },
          },
          orderBy: { academicPeriod: { number: "desc" } },
          take: 20,
        })
      : Promise.resolve([]),
    canViewCards
      ? prisma.reportCard.findMany({
          where: { schoolId: tenant.schoolId, studentId: student.id },
          include: {
            academicPeriod: {
              select: { name: true, academicYear: { select: { name: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
  ]);

  const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

  const confirmLink = student.guardians.find((l) => l.id === confirmLinkId);
  const selfHref = `/app/students/${student.id}`;

  return (
    <div className="space-y-4">
      {canManageGuardians && confirm === "unlink" && confirmLink ? (
        <ConfirmPanel
          title="Confirmer la dissociation du responsable"
          tone="danger"
          action={unlinkGuardianAction}
          fields={{ linkId: confirmLink.id, studentId: student.id }}
          confirmLabel="Détacher le responsable"
          cancelHref={selfHref}
        >
          Détacher{" "}
          <strong>
            {confirmLink.guardian.lastName} {confirmLink.guardian.firstName}
          </strong>{" "}
          ({RELATIONS[confirmLink.relation]}) de{" "}
          <strong>
            {student.lastName} {student.firstName}
          </strong>{" "}
          lui retire la visibilité et les notifications concernant cet élève.
          Réversible en rattachant à nouveau ci-dessous.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Élève</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {student.lastName} {student.firstName}
            </h1>
            <div className="mt-1 text-sm text-zinc-600">
              Matricule {student.matricule} · {statusLabel("student", student.status)}
              {student.sex
                ? ` · ${student.sex === "MALE" ? "Masculin" : "Féminin"}`
                : ""}
            </div>
          </div>
          <Link
            href="/app/students"
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

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Identité</div>
        {canManage ? (
          <form action={updateStudentAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <input type="hidden" name="id" value={student.id} />
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-1">
                  Matricule
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-1"
                  name="matricule"
                  defaultValue={student.matricule}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-2">Nom</label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-2"
                  name="lastName"
                  defaultValue={student.lastName}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-3">
                  Prénom
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-3"
                  name="firstName"
                  defaultValue={student.firstName}
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-4">Sexe</label>
                <select id="fld-src-app-app-tenant-students-id-page-tsx-4"
                  name="sex"
                  defaultValue={student.sex ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">—</option>
                  <option value="M">Masculin</option>
                  <option value="F">Féminin</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-5">
                  Date de naissance
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-5"
                  name="birthDate"
                  type="date"
                  defaultValue={d(student.birthDate)}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-6">
                  Lieu de naissance
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-6"
                  name="birthPlace"
                  defaultValue={student.birthPlace ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-7">
                  Téléphone
                </label>
                <input type="tel" id="fld-src-app-app-tenant-students-id-page-tsx-7"
                  name="phone"
                  defaultValue={student.phone ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-8">
                  Email
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-8"
                  name="email"
                  type="email"
                  defaultValue={student.email ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-9">
                  Adresse
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-9"
                  name="address"
                  defaultValue={student.address ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-10">
                  Photo (URL)
                </label>
                <input id="fld-src-app-app-tenant-students-id-page-tsx-10"
                  name="photoUrl"
                  type="url"
                  defaultValue={student.photoUrl ?? ""}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-students-id-page-tsx-11">
                  Statut
                </label>
                <select id="fld-src-app-app-tenant-students-id-page-tsx-11"
                  name="status"
                  defaultValue={student.status}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>
            </div>
            <SubmitButton
              className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer
            </SubmitButton>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-zinc-500">Matricule</dt>
              <dd className="mt-1 text-sm text-zinc-900">{student.matricule}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Naissance</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {d(student.birthDate) || "—"} · {student.birthPlace ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Contact</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {student.phone ?? "—"} · {student.email ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Adresse</dt>
              <dd className="mt-1 text-sm text-zinc-900">
                {student.address ?? "—"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Parcours scolaire
          </div>
          {student.enrollments.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucune inscription.{" "}
              <Link href="/app/enrollments" className="underline">
                Inscrire l&apos;élève
              </Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {student.enrollments.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <Link
                      href={`/app/classrooms/${e.classroom.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {e.classroom.name}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      ({e.classroom.level.name}) — {e.academicYear.name}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {statusLabel("enrollment", e.status)}
                    {e.leftAt
                      ? ` · au ${e.leftAt.toISOString().slice(0, 10)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Parents et tuteurs
          </div>
          {student.guardians.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucun responsable rattaché.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {student.guardians.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <Link
                      href={`/app/guardians/${l.guardian.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {l.guardian.lastName} {l.guardian.firstName}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      — {RELATIONS[l.relation]}
                      {l.guardian.phone ? ` · ${l.guardian.phone}` : ""}
                    </span>
                  </span>
                  {canManageGuardians ? (
                    <Link
                      href={`${selfHref}?confirm=unlink&link=${l.id}`}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Détacher
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManageGuardians ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Rattacher un responsable existant
              </summary>
              <form action={linkGuardianAction} className="mt-3 space-y-3">
                <input type="hidden" name="studentId" value={student.id} />
                <div className="flex items-end gap-2">
                  <select
                  aria-label="Tuteur à associer"
                    name="guardianId"
                    required
                    className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="">Choisir…</option>
                    {allGuardians.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.lastName} {g.firstName}
                      </option>
                    ))}
                  </select>
                  <select
                  aria-label="Lien de parenté"
                    name="relation"
                    required
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    {Object.entries(RELATIONS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <SubmitButton
                    className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    Lier
                  </SubmitButton>
                </div>
              </form>
            </details>
          ) : null}

          {canManageGuardians ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Créer et rattacher un nouveau responsable
              </summary>
              <form
                action={createAndLinkGuardianAction}
                className="mt-3 space-y-3"
              >
                <input type="hidden" name="studentId" value={student.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    aria-label="Nom" name="lastName"
                    placeholder="Nom"
                    required
                    className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                  <input
                    aria-label="Prénom" name="firstName"
                    placeholder="Prénom"
                    required
                    className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                  <input
                    aria-label="Téléphone" type="tel" name="phone"
                    placeholder="Téléphone"
                    className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                  <input
                    aria-label="Adresse e-mail" name="email"
                    type="email"
                    placeholder="Email"
                    className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                  <input
                    aria-label="Adresse" name="address"
                    placeholder="Adresse"
                    className="h-10 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                  <select
                  aria-label="Lien de parenté"
                    name="relation"
                    required
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    {Object.entries(RELATIONS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton
                  className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Créer et lier
                </SubmitButton>
              </form>
            </details>
          ) : null}
        </div>

        {canManagePortal && access ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Accès aux portails
            </div>
            {typeof sp.invite === "string" ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Invitation créée — transmettez ce lien (aucun envoi automatique) :{" "}
                <code className="break-all">{sp.invite}</code>
              </div>
            ) : null}
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2">
                <span>
                  <span className="font-medium text-zinc-900">Compte élève</span>{" "}
                  <span className="text-zinc-500">
                    {access.student.user
                      ? `${access.student.user.email} — ${
                          access.student.user.status === "ACTIVE"
                            ? "actif"
                            : access.pendingInvites.has(access.student.user.id)
                              ? "invitation en attente"
                              : "désactivé"
                        }`
                      : "non créé"}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {access.student.user ? (
                    <>
                      {access.student.user.status !== "ACTIVE" ? (
                        <form action={resendInviteAction}>
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name="userId" value={access.student.user.id} />
                          <SubmitButton className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                            Renvoyer l&apos;invitation
                          </SubmitButton>
                        </form>
                      ) : null}
                      <form action={setPortalAccessAction}>
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="userId" value={access.student.user.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={access.student.user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
                        />
                        <SubmitButton className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                          {access.student.user.status === "ACTIVE" ? "Désactiver" : "Activer"}
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    <form action={inviteStudentAction} className="flex items-center gap-1">
                      <input type="hidden" name="studentId" value={student.id} />
                      <input
                        aria-label="Adresse e-mail" name="email"
                        type="email"
                        required
                        placeholder="Email du compte"
                        className="h-8 w-44 rounded-lg border border-zinc-200 px-2 text-xs"
                      />
                      <SubmitButton className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800">
                        Activer le compte
                      </SubmitButton>
                    </form>
                  )}
                </span>
              </li>
              {access.student.guardians.map((g) => (
                <li
                  key={g.guardian.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <span className="font-medium text-zinc-900">
                      {g.guardian.lastName} {g.guardian.firstName}
                    </span>{" "}
                    <span className="text-zinc-500">
                      — {RELATIONS[g.relation] ?? g.relation} ·{" "}
                      {g.guardian.user
                        ? `${g.guardian.user.email} — ${
                            g.guardian.user.status === "ACTIVE"
                              ? "actif"
                              : access.pendingInvites.has(g.guardian.user.id)
                                ? "invitation en attente"
                                : "désactivé"
                          }`
                        : "aucun compte"}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    {g.guardian.user ? (
                      <>
                        {g.guardian.user.status !== "ACTIVE" ? (
                          <form action={resendInviteAction}>
                            <input type="hidden" name="studentId" value={student.id} />
                            <input type="hidden" name="userId" value={g.guardian.user.id} />
                            <SubmitButton className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                              Renvoyer
                            </SubmitButton>
                          </form>
                        ) : null}
                        <form action={setPortalAccessAction}>
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name="userId" value={g.guardian.user.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={g.guardian.user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
                          />
                          <SubmitButton className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                            {g.guardian.user.status === "ACTIVE" ? "Désactiver" : "Activer"}
                          </SubmitButton>
                        </form>
                      </>
                    ) : (
                      <form action={inviteGuardianAction} className="flex items-center gap-1">
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="guardianId" value={g.guardian.id} />
                        <input
                          aria-label="Adresse e-mail" name="email"
                          type="email"
                          required
                          placeholder="Email"
                          defaultValue={g.guardian.email ?? ""}
                          className="h-8 w-40 rounded-lg border border-zinc-200 px-2 text-xs"
                        />
                        <SubmitButton className="rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800">
                          Inviter
                        </SubmitButton>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">
              Les invitations expirent après 7 jours. Aucun mot de passe n&apos;est
              envoyé : le destinataire définit le sien via le lien.
            </p>
          </div>
        ) : null}

        {canViewGrades ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Notes</div>
            {gradeRows.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Aucune note saisie.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {gradeRows.slice(0, 15).map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                  >
                    <span className="font-medium text-zinc-900">
                      {g.assessment.subject.name} — {g.assessment.title}
                    </span>
                    <span className="text-xs text-zinc-600">
                      {g.status === "ENTERED" && g.value != null
                        ? `${g.value}/${g.assessment.maxScore}`
                        : g.status === "ABSENT"
                          ? "Absent"
                          : g.status === "EXEMPT"
                            ? "Dispensé"
                            : "Non noté"}
                      {g.assessment.academicPeriod
                        ? ` · ${g.assessment.academicPeriod.name}`
                        : ""}
                      {" · "}
                      {d(g.assessment.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {periodResults.length > 0 ? (
              <div className="mt-4">
                <div className="text-xs font-medium uppercase text-zinc-500">
                  Résultats par période
                </div>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {periodResults.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                    >
                      <span className="font-medium text-zinc-900">
                        {r.academicPeriod.academicYear.name} — {r.academicPeriod.name}
                        <span className="ml-2 text-xs text-zinc-500">{r.classroom.name}</span>
                      </span>
                      <span className="text-xs text-zinc-600">
                        {r.generalAverage != null
                          ? `Moy. ${r.generalAverage.toFixed(2)}/20`
                          : "—"}
                        {r.rank != null ? ` · Rang ${r.rank}` : ""}
                        {r.mention ? ` · ${r.mention}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <PendingSection title="Notes" module="Notes" />
        )}
        {canViewCards ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Bulletins</div>
            {reportCards.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Aucun bulletin généré.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {reportCards.map((card) => (
                  <li
                    key={card.id}
                    className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                  >
                    <span className="font-medium text-zinc-900">
                      {card.academicPeriod.academicYear.name} — {card.academicPeriod.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                      v{card.currentVersion} · {statusLabel("reportCard", card.status)}
                      {canPrintCards ? (
                        <a
                          href={`/app/report-cards/pdf?id=${card.id}`}
                          target="_blank"
                          className="rounded-lg border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
                        >
                          PDF
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <PendingSection title="Bulletins" module="Bulletins" />
        )}
        <PendingSection title="Paiements" module="Finances" />
        <PendingSection title="Documents" module="Documents" />
      </div>

      {canViewTimetable ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Emploi du temps — classe actuelle
            {currentEnrollment ? ` (${currentEnrollment.classroom.name})` : ""}
          </div>
          {!currentEnrollment ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucune inscription en cours — pas d&#8217;emploi du temps.
            </p>
          ) : weekSlots.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucun cours planifié cette semaine.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {weekSlots.map((s) => (
                <li
                  key={`${s.source}-${s.id}`}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {s.subjectName ?? "Cours"}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {DAY_LABEL[s.weekday]} {s.date.slice(8)}·{s.date.slice(5, 7)}{" "}
                    · {minutesToLabel(s.startMin)}–{minutesToLabel(s.endMin)} ·{" "}
                    {s.teacherName}
                    {s.roomName ? ` · ${s.roomName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {canViewAttendance ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Absences</div>
            {attSummary ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-700">
                <span>
                  Total :{" "}
                  <strong>{attSummary.absences + attSummary.justified}</strong>
                </span>
                <span>
                  Justifiées : <strong>{attSummary.justified}</strong>
                </span>
                <span>
                  Non justifiées : <strong>{attSummary.unjustified}</strong>
                </span>
              </div>
            ) : null}
            {absences.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Aucune absence.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {absences.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-zinc-100 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between">
                      <span className="text-zinc-900">
                        {d(r.date)} — {ATT_LABEL[r.status]}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {r.session?.subject?.name ??
                          (r.session ? "cours" : "journalier")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {r.reason ? `Motif : ${r.reason}` : "Sans motif"}
                      {r.justification ? ` · Justif. : ${r.justification}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Retards</div>
            {attSummary ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-700">
                <span>
                  Nombre : <strong>{attSummary.lates}</strong>
                </span>
                <span>
                  Durée cumulée : <strong>{attSummary.lateMin} min</strong>
                </span>
              </div>
            ) : null}
            {lates.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Aucun retard.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {lates.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-zinc-100 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between">
                      <span className="text-zinc-900">{d(r.date)}</span>
                      <span className="text-xs text-zinc-500">
                        {r.durationMin != null ? `${r.durationMin} min` : ""}
                        {r.session?.subject?.name
                          ? ` · ${r.session.subject.name}`
                          : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {r.reason ? `Motif : ${r.reason}` : "Sans motif"}
                      {r.justification ? ` · Justif. : ${r.justification}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
