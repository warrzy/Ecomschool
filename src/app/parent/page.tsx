import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  listParentReenrollmentDocs,
  parentReenrollmentView,
} from "@/lib/services/reenrollment";
import {
  replyReenrollAction,
  submitReenrollAction,
  uploadReenrollDocAction,
} from "./actions";
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
import {
  getParentIntent,
  getPayableInstallment,
  listParentIntents,
  listParentProviders,
  parentFinancesOverview,
} from "@/lib/services/portal/parentPayments";
import { prisma } from "@/lib/db/prisma";
import {
  cancelParentIntentAction,
  payInstallmentAction,
  refreshParentIntentAction,
} from "./actions";
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
  ["reinscription", "Réinscription"],
  ["annonces", "Annonces"],
] as const;

const INTENT_STATUS_LABELS: Record<string, string> = {
  CREATED: "Demande créée",
  PENDING: "En attente de confirmation",
  CONFIRMED: "Paiement confirmé",
  FAILED: "Paiement échoué",
  EXPIRED: "Demande expirée",
  CANCELLED: "Demande annulée",
  CONFIRMED_PENDING_POSTING: "Paiement confirmé — comptabilisation en attente",
};
const INTENT_STATUS_TONES: Record<string, string> = {
  CREATED: "bg-zinc-100 text-zinc-700",
  PENDING: "bg-amber-50 text-amber-800",
  CONFIRMED: "bg-emerald-50 text-emerald-800",
  FAILED: "bg-red-50 text-red-800",
  EXPIRED: "bg-zinc-100 text-zinc-600",
  CANCELLED: "bg-zinc-100 text-zinc-600",
  CONFIRMED_PENDING_POSTING: "bg-blue-50 text-blue-800",
};

const REENROLL_STATUS: Record<string, string> = {
  SUBMITTED: "Demande déposée",
  UNDER_REVIEW: "En cours d'instruction",
  ADDITIONAL_INFO_REQUIRED: "Complément demandé",
  APPROVED: "Approuvée — finalisation en cours",
  REJECTED: "Refusée",
  COMPLETED: "Inscription finalisée",
  CANCELLED: "Annulée",
};

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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-soft">
      {title ? <div className="mb-2 font-display text-sm font-bold text-ink">{title}</div> : null}
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

  const errCode = str("error");
  const okCode = str("ok");
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Espace parent — suivi scolaire</h1>
      {errCode ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMessage(errCode)}
        </div>
      ) : null}
      {okCode ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {okMessage(okCode)}
        </div>
      ) : null}
      {/* Sélecteur d'enfant */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {children.map((c) => (
          <Link
            key={c.student.id}
            href={`/parent?child=${c.student.id}&tab=${tab}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              c.student.id === childId
                ? "border-brand-600 bg-brand-600 text-white"
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
                  tab === key ? "bg-brand-600 text-white" : "text-zinc-600 hover:bg-mist"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          <ParentTab
            ctx={ctx}
            studentId={childId}
            tab={tab}
            schoolId={tenant.schoolId}
            pay={str("pay")}
            intentId={str("intent")}
          />
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
  pay,
  intentId,
}: {
  ctx: { userId: string; schoolId: string };
  studentId: string;
  tab: string;
  schoolId: string;
  pay?: string;
  intentId?: string;
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
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-mist"
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
    return (
      <FinancesTab
        ctx={ctx}
        studentId={studentId}
        pay={pay}
        intentId={intentId}
      />
    );
  }

  if (tab === "reinscription") {
    return <ReenrollTab ctx={ctx} studentId={studentId} />;
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

/** Onglet réinscription — limité à l'enfant sélectionné. */
async function ReenrollTab({
  ctx,
  studentId,
}: {
  ctx: { userId: string; schoolId: string };
  studentId: string;
}) {
  const view = await parentReenrollmentView(ctx);
  if (!view.campaigns.length) {
    return (
      <Card title="Réinscription">
        <p className="text-sm text-zinc-600">
          Aucune campagne de réinscription n&apos;est ouverte actuellement.
        </p>
      </Card>
    );
  }

  const items = [];
  for (const c of view.campaigns) {
    const mine = c.children.find((ch) => ch.student.id === studentId);
    if (mine) items.push({ campaign: c, mine });
  }
  if (!items.length) {
    return (
      <Card title="Réinscription">
        <p className="text-sm text-zinc-600">
          Aucune campagne de réinscription ne concerne cet enfant.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map(({ campaign: c, mine }) => (
        <Card key={c.id} title={`${c.name} — clôture le ${c.closesAt.toISOString().slice(0, 10)}`}>
          {c.familyMessage ? (
            <p className="mb-2 text-sm italic text-zinc-600">{c.familyMessage}</p>
          ) : null}
          {mine.request ? (
            <div className="space-y-3">
              <p className="text-sm">
                Statut : <strong>{REENROLL_STATUS[mine.request.status] ?? mine.request.status}</strong>
                {mine.request.kind === "DEPARTURE" ? " (départ signalé)" : ""}
              </p>
              {mine.request.decisionReason ? (
                <p className="text-sm text-zinc-600">Motif : {mine.request.decisionReason}</p>
              ) : null}
              {mine.request.messages.length ? (
                <ul className="space-y-1 border-l-2 border-zinc-200 pl-3 text-xs text-zinc-600">
                  {mine.request.messages.map((m, i) => (
                    <li key={i}>
                      <span className="text-zinc-400">
                        {m.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                      {" — "}
                      {m.body}
                    </li>
                  ))}
                </ul>
              ) : null}
              {["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"].includes(
                mine.request.status,
              ) ? (
                <>
                  <form action={replyReenrollAction} className="flex items-end gap-2">
                    <input type="hidden" name="requestId" value={mine.request.id} />
                    <label className="flex-1 text-xs font-medium text-zinc-600">
                      Votre réponse à l&apos;établissement
                      <input
                        aria-label="Réponse"
                        name="reply"
                        required
                        className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm"
                      />
                    </label>
                    <SubmitButton className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-mist">
                      Envoyer
                    </SubmitButton>
                  </form>
                  {c.requiredDocs.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500">Pièces demandées</p>
                      <ParentDocs requestId={mine.request.id} ctx={ctx} />
                      {c.requiredDocs.map((d) => (
                        <form key={d.key} action={uploadReenrollDocAction} className="mt-2 flex items-end gap-2">
                          <input type="hidden" name="requestId" value={mine.request!.id} />
                          <input type="hidden" name="docKey" value={d.key} />
                          <label className="text-xs font-medium text-zinc-600">
                            {d.label}
                            <input
                              aria-label={`Pièce ${d.label}`}
                              name="file"
                              type="file"
                              required
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="mt-1 block text-sm"
                            />
                          </label>
                          <SubmitButton className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                            Déposer
                          </SubmitButton>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : mine.eligible ? (
            <form action={submitReenrollAction} className="space-y-2">
              <input type="hidden" name="campaignId" value={c.id} />
              <input type="hidden" name="studentId" value={mine.student.id} />
              {mine.sourceClassroom ? (
                <p className="text-xs text-zinc-500">Classe actuelle : {mine.sourceClassroom}</p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium text-zinc-600">
                  Choix
                  <select
                    aria-label="Choix de réinscription"
                    name="kind"
                    className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm"
                  >
                    <option value="REENROLL">Réinscrire pour l&apos;année prochaine</option>
                    <option value="DEPARTURE">Signaler un départ</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-zinc-600">
                  Niveau souhaité (optionnel)
                  <select
                    aria-label="Niveau souhaité"
                    name="desiredLevelId"
                    className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm"
                  >
                    <option value="">— Sans changement —</option>
                    {c.levels.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs font-medium text-zinc-600">
                  Téléphone (si changé)
                  <input aria-label="Téléphone" name="phone" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm" />
                </label>
                <label className="text-xs font-medium text-zinc-600">
                  Email (si changé)
                  <input aria-label="Email" name="email" type="email" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm" />
                </label>
                <label className="text-xs font-medium text-zinc-600">
                  Adresse (si changée)
                  <input aria-label="Adresse" name="address" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm" />
                </label>
              </div>
              <label className="block text-xs font-medium text-zinc-600">
                Message à l&apos;établissement (optionnel)
                <input aria-label="Message" name="note" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm" />
              </label>
              <SubmitButton className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Envoyer la demande
              </SubmitButton>
            </form>
          ) : (
            <p className="text-sm text-zinc-600">
              Cet enfant n&apos;est pas éligible à cette campagne.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

/** Onglet finances — tableau de bord, parcours de paiement Mobile
 *  Money, suivi des demandes, historique et reçus (G3-C). */
async function FinancesTab({
  ctx,
  studentId,
  pay,
  intentId,
}: {
  ctx: { userId: string; schoolId: string };
  studentId: string;
  pay?: string;
  intentId?: string;
}) {
  const fmtN = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
  const stLabel: Record<string, string> = {
    UPCOMING: "À venir",
    PARTIAL: "Partiel",
    PAID: "Payé",
    LATE: "En retard",
  };

  const f = await getChildFinances(ctx, studentId);
  if (!f) return <Card><p className="text-sm text-red-700">Accès non autorisé.</p></Card>;

  const [overview, providers, intents, tracking, payTarget] = await Promise.all([
    parentFinancesOverview(ctx),
    listParentProviders(ctx),
    listParentIntents(ctx, studentId),
    intentId ? getParentIntent(ctx, intentId) : Promise.resolve(null),
    pay ? getPayableInstallment(ctx, studentId, pay) : Promise.resolve(null),
  ]);
  const anomalyCount = tracking
    ? await prisma.webhookEvent.count({ where: { intentId: tracking.id, status: "ANOMALY" } })
    : 0;
  const multi = overview.length > 1;
  const fmtD = (d: Date) => d.toLocaleDateString("fr-FR");

  return (
    <div className="space-y-3">
      {/* Vue consolidée famille */}
      {multi && (
        <Card title="Situation de la famille">
          <ul className="space-y-1 text-sm">
            {overview.map((r) => (
              <li key={r.student.id} className="flex flex-wrap items-center justify-between">
                <span>
                  {r.student.firstName} {r.student.lastName}
                  <span className="ml-2 text-xs text-zinc-500">{r.year ?? "—"}</span>
                </span>
                <span className="text-right text-xs sm:text-sm">
                  payé <span className="font-medium text-emerald-700">{fmtN(r.paid)}</span>
                  {" · "}solde <span className={`font-medium ${r.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>{fmtN(r.balance)}</span>
                  {r.lateInstallments > 0 && (
                    <span className="ml-1 text-red-700">· {r.lateInstallments} en retard</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Suivi d'une demande en cours */}
      {tracking && (
        <Card title="Suivi de votre demande de paiement">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between">
              <span className="font-medium">{fmtN(tracking.amount)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${INTENT_STATUS_TONES[tracking.status]}`}>
                {INTENT_STATUS_LABELS[tracking.status]}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {tracking.feeInstallment
                ? `${tracking.feeInstallment.charge.category.label}${tracking.feeInstallment.label ? ` · ${tracking.feeInstallment.label}` : ""}`
                : "Paiement libre"}
              {" — "}{tracking.provider.label}
              {tracking.provider.mode === "SANDBOX" && " (simulation)"}
            </p>
            {tracking.payment?.receiptNumber && (
              <p className="text-xs">
                Reçu : <span className="font-mono">{tracking.payment.receiptNumber}</span>
                {" — "}
                <a href={`/parent/receipts/${tracking.payment.id}/pdf`} target="_blank" className="text-brand-700 hover:underline">
                  télécharger
                </a>
              </p>
            )}
            {anomalyCount > 0 && (
              <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                Anomalie détectée — l&apos;établissement vérifie votre paiement. Aucune action n&apos;est requise de votre part.
              </p>
            )}
            {(tracking.status === "CREATED" || tracking.status === "PENDING") && (
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={refreshParentIntentAction}>
                  <input type="hidden" name="intentId" value={tracking.id} />
                  <input type="hidden" name="studentId" value={studentId} />
                  <SubmitButton
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                    pendingLabel="Actualisation…"
                  >
                    Actualiser le statut
                  </SubmitButton>
                </form>
                <form action={cancelParentIntentAction}>
                  <input type="hidden" name="intentId" value={tracking.id} />
                  <input type="hidden" name="studentId" value={studentId} />
                  <SubmitButton
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
                    pendingLabel="Annulation…"
                  >
                    Annuler la demande
                  </SubmitButton>
                </form>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Parcours de paiement */}
      {pay && (
        <Card title="Payer une échéance">
          {payTarget && providers.length > 0 ? (
            <form action={payInstallmentAction} className="space-y-3">
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="feeInstallmentId" value={payTarget.id} />
              <input type="hidden" name="idempotencyKey" value={`mmi-p-${crypto.randomUUID()}`} />
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>
                  Échéance : <strong>{payTarget.category}{payTarget.label ? ` · ${payTarget.label}` : ""}</strong>
                  <span className="ml-1 text-xs text-zinc-500">(échéance {fmtD(payTarget.dueDate)})</span>
                </li>
                <li>
                  Solde exigible : <strong>{fmtN(payTarget.remaining)}</strong>
                  {payTarget.inFlight > 0 && (
                    <span className="ml-1 text-xs text-amber-700">({fmtN(payTarget.inFlight)} déjà en cours de paiement)</span>
                  )}
                </li>
                <li>
                  <label className="block text-xs font-medium text-zinc-600">
                    Montant à payer (FCFA)
                    <input
                      name="amount" type="number" min={1} max={payTarget.remaining}
                      defaultValue={payTarget.remaining} required
                      className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm"
                    />
                  </label>
                  <span className="text-xs text-zinc-500">Paiement partiel possible, jusqu&apos;à {fmtN(payTarget.remaining)}.</span>
                </li>
                <li>
                  <label className="block text-xs font-medium text-zinc-600">
                    Opérateur
                    <select name="providerId" required className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm">
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}{p.mode === "SANDBOX" ? " (simulation)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
                <li>
                  <label className="block text-xs font-medium text-zinc-600">
                    Numéro Mobile Money du payeur
                    <input name="payerPhone" placeholder="+226 XX XX XX XX" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm" />
                  </label>
                </li>
              </ol>
              <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                <SubmitButton
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  pendingLabel="Envoi de la demande…"
                >
                  Confirmer la demande de paiement
                </SubmitButton>
                <a href={`/parent?child=${studentId}&tab=finances`} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
                  Annuler
                </a>
              </div>
            </form>
          ) : (
            <p className="text-sm text-zinc-600">
              {!payTarget
                ? "Cette échéance n'est pas payable (inexistante, soldée ou déjà couverte par une demande en cours)."
                : "Aucun moyen de paiement Mobile Money n'est disponible pour le moment."}
            </p>
          )}
        </Card>
      )}

      {!f.year ? (
        <Card><p className="text-sm text-zinc-600">Aucune inscription active.</p></Card>
      ) : (
        <>
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
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {i.category}{i.label ? ` · ${i.label}` : ""}
                      <span className="ml-2 text-xs text-zinc-500">échéance {fmtD(i.dueDate)}</span>
                    </span>
                    <span className="flex items-center gap-2 text-right">
                      <span className="font-medium">{fmtN(i.remaining)}</span>
                      <span className={`text-xs ${i.status === "LATE" ? "text-red-700" : i.status === "PAID" ? "text-emerald-700" : "text-zinc-500"}`}>
                        {stLabel[i.status]}
                      </span>
                      {i.remaining > 0 && providers.length > 0 && (
                        <Link
                          href={`/parent?child=${studentId}&tab=finances&pay=${i.id}`}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                        >
                          Payer
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-600">Aucune échéance.</p>
            )}
          </Card>

          <Card title="Mes demandes de paiement">
            {intents.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {intents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {i.createdAt.toLocaleDateString("fr-FR")} — <span className="font-medium">{fmtN(i.amount)}</span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {i.feeInstallment ? i.feeInstallment.charge.category.label : "Paiement libre"} · {i.provider.label}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${INTENT_STATUS_TONES[i.status]}`}>
                        {INTENT_STATUS_LABELS[i.status]}
                      </span>
                      <a href={`/parent?child=${studentId}&tab=finances&intent=${i.id}`} className="text-xs text-brand-700 hover:underline">
                        Suivre
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-600">Aucune demande de paiement.</p>
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
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-mist"
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
        </>
      )}
    </div>
  );
}

/** Pièces déjà déposées par le parent sur sa demande. */
async function ParentDocs({
  ctx,
  requestId,
}: {
  ctx: { userId: string; schoolId: string };
  requestId: string;
}) {
  const docs = await listParentReenrollmentDocs(ctx, requestId);
  if (!docs.length) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs text-zinc-600">
      {docs.map((d) => (
        <li key={d.id}>
          {d.label} — {d.originalName} ({Math.ceil(d.sizeBytes / 1024)} Ko)
        </li>
      ))}
    </ul>
  );
}
