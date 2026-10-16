import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  getChildAttendance,
  getChildGrades,
  getChildOverview,
  getChildFinances,
  getChildReportCards,
  getChildResults,
  getChildTimetable,
  listChildren,
  verifyChildAccess,
} from "@/lib/services/portal/parent";
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
  ["apercu", "Aperçu"],
  ["edt", "Emploi du temps"],
  ["notes", "Notes"],
  ["resultats", "Résultats"],
  ["bulletins", "Bulletins"],
  ["absences", "Absences"],
  ["finances", "Finances"],
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

export default async function ParentPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("portal.parent");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const children = await listChildren(ctx);
  if (children.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-600">
          Aucun enfant n&apos;est rattaché à votre compte. Contactez votre établissement.
        </p>
      </Card>
    );
  }

  const childId = str("child") ?? children[0].student.id;
  const allowed = await verifyChildAccess(ctx, childId);
  const tab = str("tab") ?? "apercu";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Espace parent — suivi scolaire</h1>
      {/* Sélecteur d'enfant */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {children.map((c) => (
          <Link
            key={c.student.id}
            href={`/parent?child=${c.student.id}&tab=${tab}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              c.student.id === childId
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            {c.student.firstName} {c.student.lastName}
          </Link>
        ))}
      </div>

      {!allowed ? (
        <Card>
          <p className="text-sm text-red-700">Accès non autorisé à cet élève.</p>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto border-b border-zinc-200 pb-2">
            {TABS.map(([key, label]) => (
              <Link
                key={key}
                href={`/parent?child=${childId}&tab=${key}`}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  tab === key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          <ParentTab ctx={ctx} studentId={childId} tab={tab} schoolId={tenant.schoolId} />
        </>
      )}
    </div>
  );
}

async function ParentTab({
  ctx,
  studentId,
  tab,
  schoolId,
}: {
  ctx: { userId: string; schoolId: string };
  studentId: string;
  tab: string;
  schoolId: string;
}) {
  if (tab === "apercu") {
    const o = await getChildOverview(ctx, studentId);
    if (!o?.student) return <Card><p className="text-sm text-zinc-600">Élève introuvable.</p></Card>;
    return (
      <Card title="Informations">
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Élève</dt><dd>{o.student.lastName} {o.student.firstName}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Matricule</dt><dd>{o.student.matricule}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Classe</dt><dd>{o.enrollment?.classroom.name ?? "—"}</dd></div>
          <div className="flex flex-wrap justify-between"><dt className="text-zinc-500">Année</dt><dd>{o.enrollment?.academicYear.name ?? "—"}</dd></div>
        </dl>
      </Card>
    );
  }

  if (tab === "edt") {
    const t = await getChildTimetable(ctx, studentId);
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

  if (tab === "notes") {
    const grades = await getChildGrades(ctx, studentId);
    return (
      <Card title="Notes publiées">
        {grades && grades.length > 0 ? (
          <table aria-label="Notes publiées" className="w-full text-left text-sm">
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
          <p className="text-sm text-zinc-600">Aucune note publiée pour le moment.</p>
        )}
      </Card>
    );
  }

  if (tab === "resultats") {
    const data = await getChildResults(ctx, studentId);
    if (!data || data.results.length === 0) {
      return <Card><p className="text-sm text-zinc-600">Aucun résultat publié.</p></Card>;
    }
    return (
      <div className="space-y-3">
        {data.results.map((r) => (
          <Card key={r.id} title={`${r.academicPeriod.academicYear.name} — ${r.academicPeriod.name}`}>
            <div className="mb-2 flex flex-wrap justify-between text-sm">
              <span className="text-zinc-500">Classe : {r.classroom.name}</span>
              <span className="font-semibold">
                Moyenne : {r.generalAverage != null ? `${r.generalAverage.toFixed(2)}/20` : "—"}
                {r.rank != null ? ` · Rang ${r.rank}` : ""}
                {r.mention ? ` · ${r.mention}` : ""}
              </span>
            </div>
            <table aria-label="Résultats par période" className="w-full text-left text-sm">
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
    const cards = await getChildReportCards(ctx, studentId);
    return (
      <Card title="Bulletins publiés">
        {cards && cards.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between">
                <span>
                  {c.academicPeriod.academicYear.name} — {c.academicPeriod.name}
                  <span className="ml-2 font-mono text-xs text-zinc-500">{c.identifier}</span>
                </span>
                <a
                  href={`/parent/report-cards/${c.id}/pdf`}
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
    const records = await getChildAttendance(ctx, studentId);
    return (
      <Card title="Absences et retards">
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
          <p className="text-sm text-zinc-600">Aucune absence ni retard enregistré.</p>
        )}
      </Card>
    );
  }

  if (tab === "finances") {
    const f = await getChildFinances(ctx, studentId);
    if (!f) return <Card><p className="text-sm text-red-700">Accès non autorisé.</p></Card>;
    if (!f.year) {
      return <Card><p className="text-sm text-zinc-600">Aucune inscription active.</p></Card>;
    }
    const fmtN = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
    const stLabel: Record<string, string> = {
      UPCOMING: "À venir",
      PARTIAL: "Partiel",
      PAID: "Payé",
      LATE: "En retard",
    };
    return (
      <div className="space-y-3">
        <Card title={`Situation financière — ${f.year}`}>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-zinc-500">Frais</div><div className="font-medium">{fmtN(f.charges)}</div></div>
            <div><div className="text-xs text-zinc-500">Réductions</div><div className="font-medium">{fmtN(f.discounts)}</div></div>
            <div><div className="text-xs text-zinc-500">Payé</div><div className="font-medium text-emerald-700">{fmtN(f.paid)}</div></div>
            <div><div className="text-xs text-zinc-500">Solde</div><div className="font-medium text-red-700">{fmtN(f.balance)}</div></div>
          </div>
        </Card>
        <Card title="Échéances">
          {f.installments.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {f.installments.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between">
                  <span>
                    {i.category}{i.label ? ` · ${i.label}` : ""}
                    <span className="ml-2 text-xs text-zinc-500">
                      échéance {i.dueDate.toLocaleDateString("fr-FR")}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="font-medium">{fmtN(i.remaining)}</span>
                    <span className={`ml-2 text-xs ${i.status === "LATE" ? "text-red-700" : i.status === "PAID" ? "text-emerald-700" : "text-zinc-500"}`}>
                      {stLabel[i.status]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">Aucune échéance.</p>
          )}
        </Card>
        <Card title="Paiements & reçus">
          {f.payments.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {f.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between">
                  <span>
                    {p.paidAt.toLocaleDateString("fr-FR")} — <span className="font-medium">{fmtN(p.amount)}</span>
                    <span className="ml-2 font-mono text-xs text-zinc-500">{p.receiptNumber}</span>
                  </span>
                  {p.receiptNumber ? (
                    <a
                      href={`/parent/receipts/${p.id}/pdf`}
                      target="_blank"
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50"
                    >
                      Reçu PDF
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">Aucun paiement enregistré.</p>
          )}
        </Card>
      </div>
    );
  }

  const announcements = await listPublishedAnnouncements(schoolId, "PARENTS");
  return (
    <div className="space-y-3">
      {announcements.length > 0 ? (
        announcements.map((a) => (
          <Card key={a.id} title={a.title}>
            <p className="whitespace-pre-line text-sm text-zinc-700">{a.body}</p>
            <p className="mt-2 text-xs text-zinc-500">
              {a.publishedAt?.toLocaleDateString("fr-FR")}
            </p>
          </Card>
        ))
      ) : (
        <Card><p className="text-sm text-zinc-600">Aucune annonce.</p></Card>
      )}
    </div>
  );
}
