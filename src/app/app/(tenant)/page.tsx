import Link from "next/link";
import { requireSchoolContext } from "@/lib/tenant/context";
import {
  getSchoolDashboard,
  getPedagogyDashboard,
  getEvaluationsDashboard,
} from "@/lib/services/dashboard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { financeDashboard } from "@/lib/services/finance/payments";
import { prisma } from "@/lib/db/prisma";
import {
  DashCard,
  EmptyState,
  KpiCard,
} from "@/components/ui/dash";
import { BarList, Donut, TrendBars } from "@/components/ui/charts";

export const instant = false;

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "—");
const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const fmtShort = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)} k`
      : `${n}`;

const METHOD_LABEL: Record<string, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile Money",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  OTHER: "Autre",
};

const I = {
  gradcap: "M22 10 12 5 2 10l10 5 10-5Z M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2",
  check: "M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4Z",
  megaphone: "M3 11l18-7-7 18-2.5-7.5L3 11Z",
};

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
  const announcements = await prisma.announcement.findMany({
    where: {
      schoolId: tenant.schoolId,
      publishedAt: { not: null },
      archivedAt: null,
    },
    orderBy: { publishedAt: "desc" },
    take: 3,
    select: { id: true, title: true, body: true, publishedAt: true },
  });

  return (
    <div className="space-y-5">
      {/* Bandeau établissement */}
      <div className="rounded-2xl bg-brand-950 p-6 text-white shadow-soft">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-300">
          Tableau de bord
        </div>
        <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">
          {dash.school ? dash.school.name : "ECOM-SCHOOL"}
        </h1>
        <p className="mt-1 text-sm text-brand-200">
          {dash.school?.city ?? ""}
          {dash.currentYear
            ? ` · Année courante : ${dash.currentYear.name} (${d(dash.currentYear.startDate)} → ${d(dash.currentYear.endDate)})`
            : " · Aucune année courante définie"}
        </p>
      </div>

      {/* KPI effectifs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Élèves inscrits"
          value={dash.enrolledCount}
          hint={`${dash.studentsActive} élève(s) actif(s) au total`}
          icon={I.gradcap}
          tone="brand"
          href="/app/students"
        />
        <KpiCard
          label="Enseignants actifs"
          value={dash.teachersActive}
          icon={I.users}
          tone="leaf"
          href="/app/teachers"
        />
        <KpiCard
          label="Classes"
          value={dash.classroomsActive}
          hint={dash.currentYear ? dash.currentYear.name : undefined}
          icon={I.grid}
          tone="sun"
          href="/app/classrooms"
        />
        <KpiCard
          label="Taux de présence"
          value={
            pedagogy?.attendanceRate != null
              ? `${Math.round(pedagogy.attendanceRate * 100)} %`
              : "—"
          }
          hint="marques du jour"
          icon={I.check}
          tone="mist"
          href="/app/attendance"
        />
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DashCard
          title={`Effectifs par niveau${dash.currentYear ? ` — ${dash.currentYear.name}` : ""}`}
          action={{ href: "/app/levels", label: "Niveaux" }}
        >
          {dash.byLevel.length > 0 ? (
            <BarList
              items={dash.byLevel.map((l) => ({ label: l.level, value: l.count }))}
              unit="élève(s)"
            />
          ) : (
            <EmptyState message="Aucune inscription pour l'année courante." />
          )}
        </DashCard>
        <DashCard title="Répartition filles / garçons" sub="Année courante">
          {dash.bySex.female + dash.bySex.male > 0 ? (
            <Donut
              items={[
                { label: "Filles", value: dash.bySex.female },
                { label: "Garçons", value: dash.bySex.male },
              ].filter((i) => i.value > 0)}
              centerLabel={`${dash.enrolledCount}`}
            />
          ) : (
            <EmptyState message="Aucun élève inscrit." />
          )}
        </DashCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashCard
          title="Inscriptions par mois"
          sub={dash.currentYear ? "Année courante" : "8 derniers mois"}
        >
          {dash.enrollmentsByMonth.some((m) => m.value > 0) ? (
            <TrendBars items={dash.enrollmentsByMonth} />
          ) : (
            <EmptyState message="Aucune inscription sur la période." />
          )}
        </DashCard>
        <DashCard title="Dernières inscriptions" action={{ href: "/app/enrollments", label: "Inscriptions" }}>
          {dash.latestEnrollments.length === 0 ? (
            <EmptyState message="Aucune inscription enregistrée." />
          ) : (
            <ul className="space-y-1 text-sm">
              {dash.latestEnrollments.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <Link
                      href={`/app/students/${e.student.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {e.student.lastName} {e.student.firstName}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      → {e.classroom.name}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-500">{d(e.enrolledAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>
      </div>

      {/* Activité pédagogique */}
      {pedagogy ? (
        <DashCard
          title="Activité pédagogique"
          sub={pedagogy.date.toISOString().slice(0, 10)}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Cours prévus" value={pedagogy.plannedToday} icon={I.clock} tone="brand" />
            <KpiCard label="Cours réalisés" value={pedagogy.doneToday} icon={I.check} tone="leaf" />
            <KpiCard label="Absences du jour" value={pedagogy.absencesToday} icon={I.alert} tone="coral" />
            <KpiCard label="Retards" value={pedagogy.latesToday} icon={I.clock} tone="sun" />
          </div>
        </DashCard>
      ) : null}

      {/* Évaluations */}
      {evals ? (
        <DashCard
          title="Évaluations et bulletins"
          action={{ href: "/app/grades", label: "Évaluations" }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="À venir" value={evals.upcomingEvaluations} icon={I.pen} tone="brand" />
            <KpiCard label="Ouvertes" value={evals.openEvaluations} icon={I.pen} tone="leaf" />
            <KpiCard label="Notes manquantes" value={evals.missingGrades} icon={I.alert} tone="coral" />
            <KpiCard label="Validations en attente" value={evals.pendingValidations} icon={I.check} tone="sun" />
            <KpiCard label="Bulletins publiés" value={evals.publishedReportCards} icon={I.gradcap} tone="mist" />
          </div>
        </DashCard>
      ) : null}

      {/* Finances — permission finance.read */}
      {finance ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Encaissé aujourd'hui" value={fmt(finance.paidToday)} icon={I.wallet} tone="leaf" />
            <KpiCard label="Encaissé ce mois" value={fmt(finance.paidThisMonth)} icon={I.wallet} tone="brand" />
            <KpiCard label="Solde restant" value={fmt(finance.balance)} hint={`dû : ${fmt(finance.due)}`} icon={I.alert} tone="sun" />
            <KpiCard
              label="Échéances en retard"
              value={`${finance.lateCount}`}
              hint={fmt(finance.lateAmount)}
              icon={I.alert}
              tone="coral"
              href="/app/fees/unpaid"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DashCard
              title="Encaissements mensuels"
              sub="6 derniers mois · paiements validés"
              action={{ href: "/app/fees", label: "Finances" }}
            >
              {finance.paidByMonth.some((m) => m.value > 0) ? (
                <TrendBars items={finance.paidByMonth} format={fmtShort} tone="leaf" />
              ) : (
                <EmptyState message="Aucun encaissement sur la période." />
              )}
            </DashCard>
            <DashCard title="Encaissements par méthode" sub="Année courante">
              {finance.byMethod.length > 0 ? (
                <BarList
                  items={finance.byMethod.map((m) => ({
                    label: METHOD_LABEL[m.method] ?? m.method,
                    value: m.amount,
                  }))}
                  format={(n) => fmtShort(n)}
                />
              ) : (
                <EmptyState message="Aucun paiement enregistré." />
              )}
            </DashCard>
          </div>
        </>
      ) : null}

      {/* Annonces récentes */}
      {announcements.length > 0 ? (
        <DashCard title="Annonces récentes" action={{ href: "/app/announcements", label: "Toutes" }}>
          <ul className="space-y-2 text-sm">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-xl border border-zinc-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{a.title}</span>
                  <span className="text-xs text-zinc-500">
                    {a.publishedAt?.toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-zinc-600">{a.body}</p>
              </li>
            ))}
          </ul>
        </DashCard>
      ) : null}
    </div>
  );
}
