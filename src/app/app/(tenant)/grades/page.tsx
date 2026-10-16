import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  listAssessments,
  ensureDefaultAssessmentTypes,
} from "@/lib/services/grading/assessments";
import {
  createAssessmentAction,
  setAssessmentStatusAction,
} from "@/app/app/(tenant)/grades/actions";
import type { AssessmentStatus } from "@prisma/client";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const STATUS_LABELS: Record<AssessmentStatus, string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouverte",
  SUBMITTED: "Soumise",
  VALIDATED: "Validée",
  PUBLISHED: "Publiée",
  CANCELLED: "Annulée",
};

const NEXT_STATUS: Partial<Record<AssessmentStatus, { to: AssessmentStatus; label: string }[]>> = {
  OPEN: [
    { to: "SUBMITTED", label: "Soumettre" },
    { to: "CANCELLED", label: "Annuler" },
  ],
  SUBMITTED: [
    { to: "VALIDATED", label: "Valider" },
    { to: "OPEN", label: "Rouvrir" },
  ],
  VALIDATED: [{ to: "PUBLISHED", label: "Publier" }],
};

export default async function GradesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("assessments.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");
  const confirm = str("confirm");
  const confirmId = str("id");
  const confirmTo = str("to") as AssessmentStatus | undefined;

  const canCreate = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "assessments.create",
  });
  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "assessments.manage",
  });
  const canEnter = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "grades.enter",
  });

  const filters = {
    academicYearId: str("year"),
    academicPeriodId: str("period"),
    classroomId: str("classroom"),
    status: str("status") as AssessmentStatus | undefined,
  };

  const [years, classrooms, subjects, types, { items, total }] = await Promise.all([
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
    prisma.classroom.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.subject.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ensureDefaultAssessmentTypes(c),
    listAssessments(c, { ...filters, pageSize: 100 }),
  ]);

  const periods = filters.academicYearId
    ? await prisma.academicPeriod.findMany({
        where: { schoolId: tenant.schoolId, academicYearId: filters.academicYearId },
        orderBy: { number: "asc" },
        select: { id: true, name: true },
      })
    : [];
  const teachers = await prisma.teacher.findMany({
    where: { schoolId: tenant.schoolId, status: "ACTIVE" },
    orderBy: { lastName: "asc" },
    select: { id: true, firstName: true, lastName: true },
  });

  const inputCls =
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  const confirmAssessment = items.find((a) => a.id === confirmId);
  const CONFIRM_TEXT: Partial<Record<AssessmentStatus, { title: string; body: string }>> = {
    PUBLISHED: {
      title: "Confirmer la publication",
      body: "rendra les notes visibles sur les portails parents et élèves. Une évaluation publiée ne peut plus être modifiée ni annulée.",
    },
    CANCELLED: {
      title: "Confirmer l'annulation",
      body: "marque l'évaluation comme annulée : elle est exclue des moyennes et des bulletins.",
    },
  };

  return (
    <div className="space-y-4">
      {confirm === "status" && confirmAssessment && confirmTo && CONFIRM_TEXT[confirmTo] ? (
        <ConfirmPanel
          title={CONFIRM_TEXT[confirmTo]!.title}
          tone={confirmTo === "PUBLISHED" ? "danger" : "warning"}
          action={setAssessmentStatusAction}
          fields={{ id: confirmAssessment.id, status: confirmTo }}
          confirmLabel={confirmTo === "PUBLISHED" ? "Publier l'évaluation" : "Annuler l'évaluation"}
          cancelHref="/app/grades"
        >
          {confirmTo === "PUBLISHED" ? "Publier " : "Annuler "} l&apos;évaluation{" "}
          <strong>{confirmAssessment.title}</strong> (
          {confirmAssessment.classroom.name} — {confirmAssessment.subject.name},{" "}
          {confirmAssessment._count.grades} note
          {confirmAssessment._count.grades > 1 ? "s" : ""}){" "}
          {CONFIRM_TEXT[confirmTo]!.body}
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Évaluations</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Notes et évaluations ({total})
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "FORBIDDEN"
              ? "Action non autorisée pour ce couple classe/matière."
              : error === "OUT_OF_RANGE"
                ? "Une note est hors du barème."
                : error === "LOCKED"
                  ? "L'évaluation ou la période est verrouillée."
                  : errorMessage(error)}
          </div>
        ) : null}
      </div>

      {canCreate ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">Nouvelle évaluation</div>
          <form action={createAssessmentAction} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <select name="academicYearId" required className={inputCls}>
              <option value="">Année scolaire…</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? " (courante)" : ""}
                </option>
              ))}
            </select>
            <select name="academicPeriodId" className={inputCls}>
              <option value="">Période (optionnel)</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select name="classroomId" required className={inputCls}>
              <option value="">Classe…</option>
              {classrooms.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
            <select name="subjectId" required className={inputCls}>
              <option value="">Matière…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select name="teacherId" className={inputCls}>
              <option value="">Enseignant…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.lastName} {t.firstName}</option>
              ))}
            </select>
            <select name="typeId" required className={inputCls}>
              <option value="">Type…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <input name="title" required placeholder="Titre" className={inputCls} />
            <input name="date" type="date" required className={inputCls} />
            <input name="maxScore" type="number" step="0.5" min="1" defaultValue="20" placeholder="Barème" className={inputCls} />
            <input name="coefficient" type="number" step="0.5" min="0.5" defaultValue="1" placeholder="Coefficient" className={inputCls} />
            <input name="description" placeholder="Description" className={inputCls} />
            <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              Créer
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          <select name="year" defaultValue={filters.academicYearId ?? ""} className={inputCls}>
            <option value="">Toutes les années</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select name="classroom" defaultValue={filters.classroomId ?? ""} className={inputCls}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <select name="status" defaultValue={filters.status ?? ""} className={inputCls}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
        </form>

        <form
          method="GET"
          action="/app/grades/export"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3"
        >
          <span className="text-xs font-semibold uppercase text-zinc-500">
            Exporter les notes
          </span>
          <select name="year" defaultValue={filters.academicYearId ?? ""} className={inputCls}>
            <option value="">Toutes les années</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select name="period" defaultValue={filters.academicPeriodId ?? ""} className={inputCls}>
            <option value="">Toutes les périodes</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select name="classroom" defaultValue={filters.classroomId ?? ""} className={inputCls}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <select name="subject" className={inputCls}>
            <option value="">Toutes les matières</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {canManage ? (
            <select name="teacher" className={inputCls}>
              <option value="">Tous les enseignants</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.lastName} {t.firstName}</option>
              ))}
            </select>
          ) : null}
          <select name="format" defaultValue="xlsx" className={inputCls}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-100">
            Télécharger
          </button>
          <p className="w-full text-xs text-zinc-500">
            Notes détaillées par élève et par évaluation — statuts (saisie,
            manquante, absent, dispensé, annulée), barèmes et coefficients
            inclus. Les moyennes s&apos;exportent depuis la page Moyennes.
          </p>
        </form>

        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Titre</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Classe</th>
              <th className="py-2 pr-3">Matière</th>
              <th className="py-2 pr-3">Enseignant</th>
              <th className="py-2 pr-3">Barème</th>
              <th className="py-2 pr-3">Coef.</th>
              <th className="py-2 pr-3">Notes</th>
              <th className="py-2 pr-3">Statut</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100">
                <td className="py-2 pr-3">{a.date.toLocaleDateString("fr-FR")}</td>
                <td className="py-2 pr-3 font-medium">{a.title}</td>
                <td className="py-2 pr-3">{a.type.name}</td>
                <td className="py-2 pr-3">{a.classroom.name}</td>
                <td className="py-2 pr-3">{a.subject.name}</td>
                <td className="py-2 pr-3">
                  {a.teacher ? `${a.teacher.lastName} ${a.teacher.firstName}` : "—"}
                </td>
                <td className="py-2 pr-3">/{a.maxScore}</td>
                <td className="py-2 pr-3">{a.coefficient}</td>
                <td className="py-2 pr-3">{a._count.grades}</td>
                <td className="py-2 pr-3">{STATUS_LABELS[a.status]}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canEnter && ["OPEN", "SUBMITTED", "DRAFT"].includes(a.status) ? (
                      <Link
                        href={`/app/grades/${a.id}`}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                      >
                        Saisir les notes
                      </Link>
                    ) : (
                      <Link
                        href={`/app/grades/${a.id}`}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                      >
                        Voir
                      </Link>
                    )}
                    {(canManage || canCreate) &&
                      (NEXT_STATUS[a.status] ?? []).map((t) =>
                        t.to === "PUBLISHED" || t.to === "CANCELLED" ? (
                          <Link
                            key={t.to}
                            href={`/app/grades?confirm=status&id=${a.id}&to=${t.to}`}
                            className={`rounded-lg border px-2 py-1 text-xs ${
                              t.to === "CANCELLED"
                                ? "border-red-200 text-red-700 hover:bg-red-50"
                                : "border-zinc-300 hover:bg-zinc-50"
                            }`}
                          >
                            {t.label}
                          </Link>
                        ) : (
                          <form key={t.to} action={setAssessmentStatusAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="status" value={t.to} />
                            <SubmitButton className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                              {t.label}
                            </SubmitButton>
                          </form>
                        ),
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-6 text-center text-zinc-500">
                  Aucune évaluation.
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
