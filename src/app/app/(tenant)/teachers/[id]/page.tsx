import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getTeacher } from "@/lib/services/teachers";
import {
  activateTeacherAccountAction,
  assignTeacherAction,
  removeAssignmentAction,
  updateTeacherAction,
} from "@/app/app/(tenant)/teachers/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

export default async function TeacherDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("teacher.read");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmAssignId = typeof sp.assignment === "string" ? sp.assignment : undefined;

  const teacher = await getTeacher(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!teacher) notFound();

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "teacher.manage",
  });

  const [years, classrooms, subjects] = await Promise.all([
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId, status: { not: "CLOSED" } },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
    prisma.classroom.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        academicYearId: true,
        level: { select: { name: true } },
      },
    }),
    prisma.subject.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const currentYear = years.find((y) => y.isCurrent) ?? years[0];

  const confirmAssignment = teacher.assignments.find(
    (a) => a.id === confirmAssignId,
  );
  const selfHref = `/app/teachers/${teacher.id}`;

  return (
    <div className="space-y-4">
      {canManage && confirm === "unassign" && confirmAssignment ? (
        <ConfirmPanel
          title="Confirmer le retrait de l'affectation"
          action={removeAssignmentAction}
          fields={{
            assignmentId: confirmAssignment.id,
            teacherId: teacher.id,
          }}
          confirmLabel="Retirer l'affectation"
          cancelHref={selfHref}
        >
          Retirer l&apos;affectation de{" "}
          <strong>
            {teacher.lastName} {teacher.firstName}
          </strong>{" "}
          à <strong>{confirmAssignment.classroom.name}</strong>
          {confirmAssignment.subject ? (
            <> en <strong>{confirmAssignment.subject.name}</strong></>
          ) : null}{" "}
          ({confirmAssignment.academicYear.name}). L&apos;enseignant ne pourra
          plus saisir les notes de cette classe/matière ; réversible en
          réaffectant ci-dessous.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Enseignant</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {teacher.lastName} {teacher.firstName}
            </h1>
            <div className="mt-1 text-sm text-zinc-600">
              {statusLabel("teacher", teacher.status)}
              {teacher.userId
                ? ` · Compte : ${teacher.user?.email} (${statusLabel("user", teacher.user?.status)})`
                : " · Pas de compte utilisateur"}
            </div>
          </div>
          <Link
            href="/app/teachers"
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Identité &amp; coordonnées
          </div>
          {canManage ? (
            <form action={updateTeacherAction} className="mt-4 space-y-4">
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <input type="hidden" name="id" value={teacher.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-1">
                    Nom
                  </label>
                  <input id="fld-src-app-app-tenant-teachers-id-page-tsx-1"
                    name="lastName"
                    defaultValue={teacher.lastName}
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-2">
                    Prénom
                  </label>
                  <input id="fld-src-app-app-tenant-teachers-id-page-tsx-2"
                    name="firstName"
                    defaultValue={teacher.firstName}
                    required
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-3">
                    Email
                  </label>
                  <input id="fld-src-app-app-tenant-teachers-id-page-tsx-3"
                    name="email"
                    type="email"
                    defaultValue={teacher.email ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-4">
                    Téléphone
                  </label>
                  <input type="tel" id="fld-src-app-app-tenant-teachers-id-page-tsx-4"
                    name="phone"
                    defaultValue={teacher.phone ?? ""}
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-5">
                    Statut
                  </label>
                  <select id="fld-src-app-app-tenant-teachers-id-page-tsx-5"
                    name="status"
                    defaultValue={teacher.status}
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Enregistrer
              </button>
            </form>
          ) : (
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-zinc-500">Nom</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {teacher.lastName} {teacher.firstName}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Email</dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {teacher.email ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">
                  Téléphone
                </dt>
                <dd className="mt-1 text-sm text-zinc-900">
                  {teacher.phone ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">Statut</dt>
                <dd className="mt-1 text-sm text-zinc-900">{statusLabel("teacher", teacher.status)}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Compte utilisateur
            </div>
            {teacher.userId ? (
              <p className="mt-2 text-sm text-zinc-600">
                Compte lié : {teacher.user?.email} — statut{" "}
                {teacher.user?.status}. La gestion du compte se fait dans
                Utilisateurs.
              </p>
            ) : canManage ? (
              <form
                action={activateTeacherAccountAction}
                className="mt-4 space-y-3"
              >
                <input type="hidden" name="teacherId" value={teacher.id} />
                <p className="text-sm text-zinc-600">
                  Crée un compte de connexion avec le rôle TEACHER (nécessite un
                  email renseigné).
                </p>
                <input
                  aria-label="Nouveau mot de passe" autoComplete="new-password" name="password"
                  type="password"
                  placeholder="Mot de passe (min. 8)"
                  minLength={8}
                  required
                  disabled={!teacher.email}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 disabled:bg-zinc-50"
                />
                <button
                  type="submit"
                  disabled={!teacher.email}
                  className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                >
                  Activer le compte
                </button>
                {!teacher.email ? (
                  <p className="text-xs text-zinc-500">
                    Renseignez d&apos;abord un email pour l&apos;enseignant.
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">
                Aucun compte utilisateur lié.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Professeur principal de
            </div>
            {teacher.headOfClassrooms.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">
                Aucune classe en responsabilité.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {teacher.headOfClassrooms.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/classrooms/${c.id}`}
                      className="text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      ({c.academicYear.name})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Affectations</div>
        <div className="mt-3 overflow-x-auto">
          <table aria-label="Affectations de l&apos;enseignant" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Classe</th>
                <th scope="col" className="py-2 pr-4">Niveau</th>
                <th scope="col" className="py-2 pr-4">Matière</th>
                <th scope="col" className="py-2 pr-4">Année</th>
                {canManage ? <th scope="col" className="py-2 pr-4"></th> : null}
              </tr>
            </thead>
            <tbody>
              {teacher.assignments.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 text-zinc-900">
                    <Link
                      href={`/app/classrooms/${a.classroom.id}`}
                      className="hover:underline"
                    >
                      {a.classroom.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.classroom.level.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.subject?.name ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.academicYear.name}
                  </td>
                  {canManage ? (
                    <td className="py-2 pr-4">
                      <Link
                        href={`${selfHref}?confirm=unassign&assignment=${a.id}`}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                      >
                        Retirer
                      </Link>
                    </td>
                  ) : null}
                </tr>
              ))}
              {teacher.assignments.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={5}>
                    Aucune affectation
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <form action={assignTeacherAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <input type="hidden" name="teacherId" value={teacher.id} />
            <div className="grid items-end gap-4 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-6">
                  Année
                </label>
                <select id="fld-src-app-app-tenant-teachers-id-page-tsx-6"
                  name="academicYearId"
                  defaultValue={currentYear?.id ?? ""}
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
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-7">
                  Classe
                </label>
                <select id="fld-src-app-app-tenant-teachers-id-page-tsx-7"
                  name="classroomId"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.level.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-teachers-id-page-tsx-8">
                  Matière (optionnel)
                </label>
                <select id="fld-src-app-app-tenant-teachers-id-page-tsx-8"
                  name="subjectId"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Affecter
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              La classe doit appartenir à l&apos;année scolaire sélectionnée.
            </p>
          </form>
        ) : null}
      </div>

      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
        <div className="text-sm font-medium text-zinc-800">
          Emploi du temps — module futur
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          L&apos;emploi du temps de l&apos;enseignant sera disponible avec le
          module Emplois du temps.
        </p>
      </div>
    </div>
  );
}
