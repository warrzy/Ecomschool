import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  calculateClassPeriod,
  getClassResults,
} from "@/lib/services/grading/results";
import {
  computeResultsAction,
  setValidationStatusAction,
  computeAnnualAction,
} from "@/app/app/(tenant)/averages/actions";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculé",
  PENDING_VALIDATION: "À valider",
  VALIDATED: "Validé",
  PUBLISHED: "Publié",
  RECTIFIED: "Rectifié",
};

export default async function AveragesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("results.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");
  const classroomId = str("classroom");
  const periodId = str("period");
  const yearId = str("year");

  const [canCalculate, canValidate, canPublish] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "grades.calculate" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "results.validate" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "results.publish" }),
  ]);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const currentYear = years.find((y) => y.isCurrent) ?? years[0];
  const selYear = yearId ?? currentYear?.id;

  const [classrooms, periods] = selYear
    ? await Promise.all([
        prisma.classroom.findMany({
          where: { schoolId: tenant.schoolId, academicYearId: selYear },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.academicPeriod.findMany({
          where: { schoolId: tenant.schoolId, academicYearId: selYear },
          orderBy: { number: "asc" },
          select: { id: true, name: true, isLocked: true },
        }),
      ])
    : [[], []];

  // Aperçu calculé à la volée + résultats persistés + validation
  let preview = null;
  let stored = null;
  if (classroomId && periodId) {
    const calc = await calculateClassPeriod(c, { classroomId, academicPeriodId: periodId });
    if (calc.ok) preview = calc.result;
    stored = await getClassResults(c, classroomId, periodId);
  }

  const annualResults = yearId
    ? await prisma.studentAnnualResult.findMany({
        where: { schoolId: tenant.schoolId, academicYearId: yearId },
        include: { student: { select: { matricule: true, firstName: true, lastName: true } } },
        orderBy: [{ rank: "asc" }],
        take: 100,
      })
    : [];

  const inputCls =
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Résultats</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Moyennes, classements et résultats annuels
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "computed" ? "Moyennes calculées et enregistrées."
              : ok === "validated" ? "Résultats validés."
              : ok === "published" ? "Résultats publiés — bulletins consultables."
              : ok === "annual" ? "Résultats annuels calculés."
              : ok === "rectified" ? "Résultats rectifiés." : ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "INVALID_STATUS" ? "Transition de statut non autorisée." : error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select name="year" defaultValue={selYear ?? ""} className={inputCls}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (courante)" : ""}</option>
            ))}
          </select>
          <select name="classroom" defaultValue={classroomId ?? ""} required className={inputCls}>
            <option value="">Classe…</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <select name="period" defaultValue={periodId ?? ""} required className={inputCls}>
            <option value="">Période…</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isLocked ? " (verrouillée)" : ""}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Afficher
          </button>
          {canCalculate && classroomId && periodId ? (
            <button
              type="submit"
              form="compute-form"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Calculer les moyennes
            </button>
          ) : null}
        </form>
        {canCalculate && classroomId && periodId ? (
          <form id="compute-form" action={computeResultsAction}>
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="academicPeriodId" value={periodId} />
          </form>
        ) : null}
      </div>

      {preview && stored ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-900">
              Statut : {STATUS_LABELS[stored.validation?.status ?? "DRAFT"]}
              {preview.missing.length > 0 ? (
                <span className="ml-3 text-amber-600">
                  {preview.missing.length} note(s) manquante(s) signalée(s)
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              {canValidate && stored.validation?.status === "CALCULATED" ? (
                <form action={setValidationStatusAction}>
                  <input type="hidden" name="classroomId" value={classroomId} />
                  <input type="hidden" name="academicPeriodId" value={periodId} />
                  <input type="hidden" name="status" value="VALIDATED" />
                  <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    Valider les résultats
                  </button>
                </form>
              ) : null}
              {canPublish && stored.validation?.status === "VALIDATED" ? (
                <form action={setValidationStatusAction}>
                  <input type="hidden" name="classroomId" value={classroomId} />
                  <input type="hidden" name="academicPeriodId" value={periodId} />
                  <input type="hidden" name="status" value="PUBLISHED" />
                  <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    Publier
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Moyenne de classe", preview.stats.classAverage?.toFixed(2) ?? "—"],
              ["Meilleure moyenne", preview.stats.bestAverage?.toFixed(2) ?? "—"],
              ["Moyenne la plus faible", preview.stats.worstAverage?.toFixed(2) ?? "—"],
              ["Ayant la moyenne", `${preview.stats.passed}/${preview.stats.ranked}`],
              ["Taux de réussite", preview.stats.successRate != null ? `${preview.stats.successRate} %` : "—"],
              ["Inscrits", String(preview.stats.enrolled)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">{l}</div>
                <div className="mt-1 text-lg font-semibold">{v}</div>
              </div>
            ))}
          </div>

          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-3">Rang</th>
                <th className="py-2 pr-3">Matricule</th>
                <th className="py-2 pr-3">Élève</th>
                <th className="py-2 pr-3">Moyenne</th>
                <th className="py-2 pr-3">Mention</th>
                <th className="py-2">Complet</th>
              </tr>
            </thead>
            <tbody>
              {[...preview.students]
                .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
                .map((s) => (
                  <tr key={s.studentId} className="border-b border-zinc-100">
                    <td className="py-2 pr-3">{s.rank ?? "—"}</td>
                    <td className="py-2 pr-3 text-zinc-500">{s.matricule}</td>
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    <td className="py-2 pr-3">
                      {s.generalAverage != null ? `${s.generalAverage.toFixed(2)}/20` : "—"}
                    </td>
                    <td className="py-2 pr-3">{s.mention ?? "—"}</td>
                    <td className="py-2">{s.complete ? "Oui" : "Non"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-900">Résultats annuels</div>
          {canCalculate && yearId ? (
            <form action={computeAnnualAction}>
              <input type="hidden" name="academicYearId" value={yearId} />
              <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
                Calculer les résultats annuels
              </button>
            </form>
          ) : null}
        </div>
        {annualResults.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-3">Rang</th>
                <th className="py-2 pr-3">Matricule</th>
                <th className="py-2 pr-3">Élève</th>
                <th className="py-2 pr-3">Moyenne annuelle</th>
                <th className="py-2 pr-3">Mention</th>
                <th className="py-2">Décision</th>
              </tr>
            </thead>
            <tbody>
              {annualResults.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-3">{r.rank ?? "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500">{r.student.matricule}</td>
                  <td className="py-2 pr-3 font-medium">
                    {r.student.lastName} {r.student.firstName}
                  </td>
                  <td className="py-2 pr-3">
                    {r.annualAverage != null ? `${r.annualAverage.toFixed(2)}/20` : "—"}
                  </td>
                  <td className="py-2 pr-3">{r.mention ?? "—"}</td>
                  <td className="py-2">{r.decision ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-sm text-zinc-500">Aucun résultat annuel calculé pour cette année.</div>
        )}
      </div>
    </div>
  );
}
