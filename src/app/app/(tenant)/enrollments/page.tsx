import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listEnrollments } from "@/lib/services/enrollments";
import {
  closeEnrollmentAction,
  enrollStudentAction,
  transferStudentAction,
} from "@/app/app/(tenant)/enrollments/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "—");

export default async function EnrollmentsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("enrollment.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;
  const confirmTo = typeof sp.to === "string" ? sp.to : undefined;

  const yearId = typeof sp.year === "string" ? sp.year : undefined;
  const classroomId = typeof sp.classroom === "string" ? sp.classroom : undefined;
  const status = (typeof sp.status === "string" ? sp.status : "ENROLLED") as
    | "ENROLLED"
    | "TRANSFERRED"
    | "WITHDRAWN"
    | "COMPLETED";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "enrollment.manage",
  });

  const [{ items, total, pageSize }, years, classrooms, students] =
    await Promise.all([
      listEnrollments(
        { userId: tenant.userId, schoolId: tenant.schoolId },
        {
          academicYearId: yearId,
          classroomId,
          status,
          q,
          page,
        },
      ),
      prisma.academicYear.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, isCurrent: true, status: true },
      }),
      prisma.classroom.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          academicYearId: true,
          level: { select: { name: true } },
        },
      }),
      prisma.student.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, matricule: true, firstName: true, lastName: true },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentYear = years.find((y) => y.isCurrent);
  const confirmEnrollment = items.find((e) => e.id === confirmId);
  const confirmTargetClass = classrooms.find((c) => c.id === confirmTo);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (yearId) params.set("year", yearId);
    if (classroomId) params.set("classroom", classroomId);
    params.set("status", status);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    return `/app/enrollments?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      {canManage && confirm === "transfer" && confirmEnrollment && confirmTargetClass ? (
        <ConfirmPanel
          title="Confirmer le transfert de classe"
          action={transferStudentAction}
          fields={{
            enrollmentId: confirmEnrollment.id,
            toClassroomId: confirmTargetClass.id,
          }}
          confirmLabel="Transférer l'élève"
          cancelHref="/app/enrollments"
        >
          Transférer{" "}
          <strong>
            {confirmEnrollment.student.lastName}{" "}
            {confirmEnrollment.student.firstName} (
            {confirmEnrollment.student.matricule})
          </strong>{" "}
          de <strong>{confirmEnrollment.classroom.name}</strong> vers{" "}
          <strong>{confirmTargetClass.name}</strong>. L&apos;historique des notes
          et présences est conservé ; l&apos;élève quittera la grille de la
          classe actuelle.
        </ConfirmPanel>
      ) : null}
      {canManage && confirm === "close" && confirmEnrollment ? (
        <ConfirmPanel
          title="Confirmer le retrait de l'inscription"
          tone="danger"
          action={closeEnrollmentAction}
          fields={{
            enrollmentId: confirmEnrollment.id,
            status: "WITHDRAWN",
          }}
          confirmLabel="Retirer l'élève"
          cancelHref="/app/enrollments"
        >
          Retirer{" "}
          <strong>
            {confirmEnrollment.student.lastName}{" "}
            {confirmEnrollment.student.firstName} (
            {confirmEnrollment.student.matricule})
          </strong>{" "}
          de <strong>{confirmEnrollment.classroom.name}</strong> termine son
          inscription pour {confirmEnrollment.academicYear.name}.{" "}
          <strong>Cette action est irréversible</strong> — une nouvelle
          inscription serait nécessaire pour le réinscrire.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Scolarité</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Inscriptions
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
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
            <label className="text-xs font-medium text-zinc-500">Année</label>
            <select
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
            <label className="text-xs font-medium text-zinc-500">Classe</label>
            <select
              name="classroom"
              defaultValue={classroomId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Statut</label>
            <select
              name="status"
              defaultValue={status}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="ENROLLED">Inscrits</option>
              <option value="TRANSFERRED">Transférés</option>
              <option value="WITHDRAWN">Retirés</option>
              <option value="COMPLETED">Terminés</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              Recherche
            </label>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Élève, matricule…"
              className="h-10 w-48 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
            />
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
            Nouvelle inscription
          </div>
          <form action={enrollStudentAction} className="mt-4">
            <div className="grid items-end gap-4 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Élève
                </label>
                <select
                  name="studentId"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Choisir…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.lastName} {s.firstName} ({s.matricule})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">
                  Année
                </label>
                <select
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
                <label className="text-sm font-medium text-zinc-800">
                  Classe
                </label>
                <select
                  name="classroomId"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Choisir…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.level.name}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton
                className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Inscrire
              </SubmitButton>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              La classe doit appartenir à l&apos;année scolaire choisie ; un
              élève ne peut avoir qu&apos;une inscription active par année.
            </p>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm text-zinc-600">
          {total} inscription{total > 1 ? "s" : ""} — page {page}/{totalPages}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Élève</th>
                <th className="py-2 pr-4">Classe</th>
                <th className="py-2 pr-4">Année</th>
                <th className="py-2 pr-4">Du</th>
                <th className="py-2 pr-4">Au</th>
                <th className="py-2 pr-4">Statut</th>
                {canManage ? <th className="py-2 pr-4">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/app/students/${e.student.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {e.student.lastName} {e.student.firstName}
                    </Link>
                    <span className="text-zinc-500"> ({e.student.matricule})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    <Link
                      href={`/app/classrooms/${e.classroom.id}?tab=students`}
                      className="hover:underline"
                    >
                      {e.classroom.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {e.academicYear.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {d(e.enrolledAt)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{d(e.leftAt)}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {statusLabel("enrollment", e.status)}
                  </td>
                  {canManage ? (
                    <td className="py-2 pr-4">
                      {e.status === "ENROLLED" ? (
                        <div className="flex items-center gap-2">
                          {/* GET vers ?confirm=transfer — la vraie action est
                              dans le panneau de confirmation. */}
                          <form id={`tr-${e.id}`} method="GET" action="/app/enrollments" />
                          <select
                            form={`tr-${e.id}`}
                            name="to"
                            required
                            className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                          >
                            <option value="">→ Classe…</option>
                            {classrooms
                              .filter(
                                (c) =>
                                  c.academicYearId ===
                                    e.academicYear.id && c.id !== e.classroom.id,
                              )
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                          <input form={`tr-${e.id}`} type="hidden" name="confirm" value="transfer" />
                          <input form={`tr-${e.id}`} type="hidden" name="id" value={e.id} />
                          <button
                            type="submit"
                            form={`tr-${e.id}`}
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
                          >
                            Transférer
                          </button>
                          <Link
                            href={`/app/enrollments?confirm=close&id=${e.id}`}
                            className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Retirer
                          </Link>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={7}>
                    Aucune inscription
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
