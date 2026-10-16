import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  getStudentAttendance,
  getStudentGrades,
  getStudentOverview,
  getStudentReportCards,
  getStudentResults,
  getStudentSubjects,
  getStudentTimetable,
  resolveStudent,
} from "@/lib/services/portal/student";
import { listPublishedAnnouncements } from "@/lib/services/announcements";

export const instant = false;

const DAY: Record<string, string> = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};
const DAYS_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const TABS = [
  ["profil", "Mon profil"],
  ["edt", "Emploi du temps"],
  ["matieres", "Matières"],
  ["notes", "Notes"],
  ["resultats", "Résultats"],
  ["bulletins", "Bulletins"],
  ["absences", "Absences"],
  ["annonces", "Annonces"],
] as const;

const GRADE_STATUS: Record<string, string> = {
  ENTERED: "",
  MISSING: "Non noté",
  ABSENT: "Absent",
  EXEMPT: "Dispensé",
  CANCELLED: "Annulé",
};

function min2h(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      {title ? <div className="mb-2 text-sm font-semibold text-zinc-900">{title}</div> : null}
      {children}
    </div>
  );
}

export default async function StudentPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("portal.student");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const tab = typeof sp.tab === "string" ? sp.tab : "profil";

  const student = await resolveStudent(ctx);
  if (!student) {
    return (
      <Card>
        <p className="text-sm text-zinc-600">
          Votre compte n&apos;est pas rattaché à un dossier élève. Contactez votre établissement.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Espace élève</h1>
      <div className="flex gap-2 overflow-x-auto border-b border-zinc-200 pb-2">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/student?tab=${key}`}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
              tab === key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <StudentTab ctx={ctx} tab={tab} schoolId={tenant.schoolId} />
    </div>
  );
}

async function StudentTab({
  ctx,
  tab,
  schoolId,
}: {
  ctx: { userId: string; schoolId: string };
  tab: string;
  schoolId: string;
}) {
  if (tab === "profil") {
    const o = await getStudentOverview(ctx);
    return (
      <Card title="Mon profil">
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Nom</dt><dd>{o?.student.lastName} {o?.student.firstName}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Matricule</dt><dd>{o?.student.matricule}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Naissance</dt><dd>{o?.student.birthDate?.toLocaleDateString("fr-FR") ?? "—"}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Classe</dt><dd>{o?.enrollment?.classroom.name ?? "—"}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Niveau</dt><dd>{o?.enrollment?.classroom.level?.name ?? "—"}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Année</dt><dd>{o?.enrollment?.academicYear.name ?? "—"}</dd></div>
        </dl>
      </Card>
    );
  }

  if (tab === "edt") {
    const t = await getStudentTimetable(ctx);
    if (!t) return <Card><p className="text-sm text-zinc-600">Aucune classe active.</p></Card>;
    const byDay = new Map<string, typeof t.schedules>();
    for (const s of t.schedules) {
      if (!byDay.has(s.weekday)) byDay.set(s.weekday, []);
      byDay.get(s.weekday)!.push(s);
    }
    return (
      <div className="space-y-3">
        {DAYS_ORDER.filter((d) => byDay.has(d)).map((d) => (
          <Card key={d} title={DAY[d]}>
            <ul className="space-y-1 text-sm">
              {byDay.get(d)!.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between">
                  <span>{min2h(s.startMin)}–{min2h(s.endMin)}</span>
                  <span className="font-medium">{s.subject?.name ?? "—"}</span>
                  <span className="text-zinc-500">{s.teacher.lastName}{s.room ? ` · ${s.room.name}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    );
  }

  if (tab === "matieres") {
    const subs = await getStudentSubjects(ctx);
    return (
      <Card title="Mes matières">
        {subs && subs.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between">
                <span>{s.subject.name}{s.subject.subjectGroup ? ` (${s.subject.subjectGroup})` : ""}</span>
                <span className="text-zinc-500">coef. {s.coefficient}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">Aucune matière configurée.</p>
        )}
      </Card>
    );
  }

  if (tab === "notes") {
    const grades = await getStudentGrades(ctx);
    return (
      <Card title="Mes notes publiées">
        {grades && grades.length > 0 ? (
          <table aria-label="Mes notes publiées" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                <th scope="col" className="py-1">Date</th><th scope="col">Matière</th><th scope="col">Évaluation</th><th scope="col" className="text-right">Note</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id} className="border-b border-zinc-100">
                  <td className="py-1">{g.assessment.date.toLocaleDateString("fr-FR")}</td>
                  <td>{g.assessment.subject.name}</td>
                  <td>{g.assessment.title}</td>
                  <td className="text-right font-medium">
                    {g.value != null ? `${g.value}/${g.assessment.maxScore}` : GRADE_STATUS[g.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-zinc-600">Aucune note publiée.</p>
        )}
      </Card>
    );
  }

  if (tab === "resultats") {
    const data = await getStudentResults(ctx);
    if (!data || data.results.length === 0) {
      return <Card><p className="text-sm text-zinc-600">Aucun résultat publié.</p></Card>;
    }
    return (
      <div className="space-y-3">
        {data.results.map((r) => (
          <Card key={r.id} title={`${r.academicPeriod.academicYear.name} — ${r.academicPeriod.name}`}>
            <div className="mb-2 flex flex-wrap justify-between text-sm">
              <span className="text-zinc-500">{r.classroom.name}</span>
              <span className="font-semibold">
                Moyenne : {r.generalAverage != null ? `${r.generalAverage.toFixed(2)}/20` : "—"}
                {r.rank != null ? ` · Rang ${r.rank}` : ""}
                {r.mention ? ` · ${r.mention}` : ""}
              </span>
            </div>
            <table aria-label="Mes résultats par période" className="w-full text-left text-sm">
              <tbody>
                {data.subjects
                  .filter((s) => s.academicPeriodId === r.academicPeriodId)
                  .map((s) => (
                    <tr key={s.id} className="border-b border-zinc-100">
                      <td className="py-1">{s.subject.name}</td>
                      <td className="py-1 text-right">
                        {s.average != null ? s.average.toFixed(2) : "—"}
                        {s.coefficient != null ? ` (coef. ${s.coefficient})` : ""}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    );
  }

  if (tab === "bulletins") {
    const cards = await getStudentReportCards(ctx);
    return (
      <Card title="Mes bulletins">
        {cards && cards.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between">
                <span>
                  {c.academicPeriod.academicYear.name} — {c.academicPeriod.name}
                  <span className="ml-2 font-mono text-xs text-zinc-500">{c.identifier}</span>
                </span>
                <a
                  href={`/student/report-cards/${c.id}/pdf`}
                  target="_blank"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50"
                >
                  PDF
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">Aucun bulletin publié.</p>
        )}
      </Card>
    );
  }

  if (tab === "absences") {
    const records = await getStudentAttendance(ctx);
    return (
      <Card title="Mes absences et retards">
        {records && records.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between">
                <span>
                  {r.date.toLocaleDateString("fr-FR")} —{" "}
                  {r.status === "ABSENT" ? "Absence" : `Retard${r.durationMin ? ` (${r.durationMin} min)` : ""}`}
                </span>
                <span className={`text-xs ${r.justifiedAt ? "text-emerald-700" : "text-amber-700"}`}>
                  {r.justifiedAt ? "Justifié" : "Non justifié"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">Aucune absence ni retard.</p>
        )}
      </Card>
    );
  }

  const announcements = await listPublishedAnnouncements(schoolId, "STUDENTS");
  return (
    <div className="space-y-3">
      {announcements.length > 0 ? (
        announcements.map((a) => (
          <Card key={a.id} title={a.title}>
            <p className="whitespace-pre-line text-sm text-zinc-700">{a.body}</p>
            <p className="mt-2 text-xs text-zinc-500">{a.publishedAt?.toLocaleDateString("fr-FR")}</p>
          </Card>
        ))
      ) : (
        <Card><p className="text-sm text-zinc-600">Aucune annonce.</p></Card>
      )}
    </div>
  );
}
