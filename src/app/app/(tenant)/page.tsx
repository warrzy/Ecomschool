import Link from "next/link";
import { requireSchoolContext } from "@/lib/tenant/context";
import {
  getSchoolDashboard,
  getPedagogyDashboard,
  getEvaluationsDashboard,
} from "@/lib/services/dashboard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { financeDashboard } from "@/lib/services/finance/payments";

export const instant = false;

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "—");
const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const tenant = await requireSchoolContext();
  const dash = await getSchoolDashboard({ schoolId: tenant.schoolId });
  const canViewAttendance = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "attendance.read",
  });
  const pedagogy = canViewAttendance
    ? await getPedagogyDashboard({ schoolId: tenant.schoolId })
    : null;
  const canViewResults = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "results.read",
  });
  const evals = canViewResults
    ? await getEvaluationsDashboard({ schoolId: tenant.schoolId })
    : null;
  const canViewFinance = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "finance.read",
  });
  const finance =
    canViewFinance && dash.currentYear
      ? await financeDashboard(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          { academicYearId: dash.currentYear.id },
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Tableau de bord</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {dash.school ? dash.school.name : "ECOM-SCHOOL"}
        </h1>
        <div className="mt-1 text-sm text-zinc-600">
          {dash.school?.city ?? ""}
          {dash.currentYear
            ? ` · Année courante : ${dash.currentYear.name} (${d(dash.currentYear.startDate)} → ${d(dash.currentYear.endDate)})`
            : " · Aucune année courante définie"}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card
          label="Élèves inscrits (année courante)"
          value={dash.enrolledCount}
          hint={`${dash.studentsActive} élève(s) actif(s) au total`}
        />
        <Card label="Enseignants actifs" value={dash.teachersActive} />
        <Card
          label="Classes (année courante)"
          value={dash.classroomsActive}
        />
        <Card
          label="Répartition filles/garçons"
          value={`${dash.bySex.female} / ${dash.bySex.male}`}
          hint="Élèves inscrits à l'année courante"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Effectifs par niveau
            {dash.currentYear ? ` — ${dash.currentYear.name}` : ""}
          </div>
          {dash.byLevel.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">
              Aucune inscription pour l&apos;année courante.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {dash.byLevel.map((l) => (
                <li
                  key={l.level}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">{l.level}</span>
                  <span className="text-zinc-600">{l.count} élève(s)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Dernières inscriptions
          </div>
          {dash.latestEnrollments.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">
              Aucune inscription enregistrée.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {dash.latestEnrollments.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <Link
                      href={`/app/students/${e.student.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {e.student.lastName} {e.student.firstName}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      → {e.classroom.name} ({e.academicYear.name})
                    </span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {d(e.enrolledAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {pedagogy ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Activité pédagogique —{" "}
            {pedagogy.date.toISOString().slice(0, 10)}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Card label="Cours prévus aujourd&#8217;hui" value={pedagogy.plannedToday} />
            <Card label="Cours réalisés" value={pedagogy.doneToday} />
            <Card label="Enseignants en cours" value={pedagogy.teachersInClass} />
            <Card label="Classes en séance" value={pedagogy.classesInSession} />
            <Card label="Absences du jour" value={pedagogy.absencesToday} />
            <Card label="Retards du jour" value={pedagogy.latesToday} />
            <Card
              label="Taux de présence"
              value={
                pedagogy.attendanceRate != null
                  ? `${Math.round(pedagogy.attendanceRate * 100)} %`
                  : "—"
              }
              hint="Marques enregistrées aujourd&#8217;hui"
            />
            <Card label="Séances annulées" value={pedagogy.cancelledToday} />
          </div>
        </div>
      ) : null}

      {evals ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Évaluations et bulletins
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-5">
            <Card label="Évaluations à venir" value={evals.upcomingEvaluations} />
            <Card label="Évaluations ouvertes" value={evals.openEvaluations} />
            <Card label="Notes manquantes" value={evals.missingGrades} />
            <Card
              label="Résultats en attente de validation"
              value={evals.pendingValidations}
            />
            <Card label="Bulletins publiés" value={evals.publishedReportCards} />
          </div>
        </div>
      ) : null}

      {finance ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between">
            <div className="text-sm font-medium text-zinc-900">
              Finances — année courante
            </div>
            <Link
              href="/app/fees"
              className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline"
            >
              Voir les finances →
            </Link>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Card label="Encaissé ce mois" value={fmt(finance.paidThisMonth)} />
            <Card label="Encaissé (année)" value={fmt(finance.paid)} />
            <Card label="Solde restant" value={fmt(finance.balance)} />
            <Card
              label="Échéances en retard"
              value={`${finance.lateCount} (${fmt(finance.lateAmount)})`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
