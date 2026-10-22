import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  admissionDashboardStats,
  campaignCapacityStats,
  getApplicationDetail,
  listApplications,
  listAssignableMembers,
  listCampaigns,
  listUpcomingInterviews,
} from "@/lib/services/admissions";
import {
  addInternalNoteAction,
  assignInstructorAction,
  decideApplicationAction,
  interviewOutcomeAction,
  reopenDecisionAction,
  requestComplementAction,
  rescheduleInterviewAction,
  scheduleInterviewAction,
  transitionApplicationAction,
} from "@/app/app/(tenant)/admissions/actions";
import { RotateSecretButton } from "@/app/app/(tenant)/admissions/ui/rotate-secret";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { AdmissionApplicationStatus } from "@prisma/client";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Reçu",
  UNDER_REVIEW: "En instruction",
  ADDITIONAL_INFO_REQUIRED: "Complément demandé",
  WAITLISTED: "Liste d'attente",
  ACCEPTED: "Admis",
  CONDITIONALLY_ACCEPTED: "Admis sous condition",
  REJECTED: "Refusé",
  CONVERTED: "Converti",
  WITHDRAWN: "Retiré",
  DRAFT: "Brouillon",
};

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  INTERVIEW: "Entretien",
  WRITTEN_TEST: "Test écrit",
  EVALUATION: "Évaluation",
  OTHER: "Autre",
};

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planifié",
  COMPLETED: "Réalisé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absent",
};

const COMPLEMENT_LABELS: Record<string, string> = {
  DOC_MISSING: "Pièce manquante",
  DOC_REPLACE: "Remplacement de pièce",
  INFO_REQUEST: "Information complémentaire",
  CORRECTION: "Correction de dossier",
};

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
const input =
  "mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm";
const btn =
  "rounded-lg px-3 py-2 text-sm font-medium";
const btnPrimary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const btnWarn = `${btn} border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100`;
const btnDanger = `${btn} border border-red-300 bg-red-50 text-red-800 hover:bg-red-100`;
const btnNeutral = `${btn} border border-zinc-300 bg-white text-zinc-700 hover:bg-mist`;

const DECIDABLE: AdmissionApplicationStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADDITIONAL_INFO_REQUIRED",
  "WAITLISTED",
  "CONDITIONALLY_ACCEPTED",
];
const REOPENABLE: AdmissionApplicationStatus[] = [
  "REJECTED",
  "CONDITIONALLY_ACCEPTED",
  "WAITLISTED",
];
const IN_REVIEW: AdmissionApplicationStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADDITIONAL_INFO_REQUIRED",
];

export default async function AdmissionsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("admissions.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const detailId = str("id");
  const filters = {
    campaignId: str("campaignId") || undefined,
    status: str("status") as AdmissionApplicationStatus | undefined,
    levelId: str("levelId") || undefined,
    q: str("q") || undefined,
  };

  const [canReview, canManage, canDecide] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "admissions.review",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "admissions.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "admissions.decide",
    }),
  ]);

  const [applications, campaigns, levels, stats, upcoming] = await Promise.all([
    listApplications(ctx, filters),
    listCampaigns(ctx),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    admissionDashboardStats(ctx),
    canReview ? listUpcomingInterviews(ctx) : Promise.resolve([]),
  ]);
  const detail = detailId ? await getApplicationDetail(ctx, detailId) : null;
  const capacity = detail
    ? await campaignCapacityStats(ctx, detail.application.campaignId)
    : null;
  const assignees = canReview ? await listAssignableMembers(ctx) : [];
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  const fmtDT = (d: Date | null) =>
    d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
  const dtlValue = (d: Date) => d.toISOString().slice(0, 16);

  const statCards: { label: string; value: number; tone?: string }[] = [
    { label: "Candidatures", value: stats.total },
    { label: "Nouveaux (7 j)", value: stats.recent },
    { label: "Incomplets", value: stats.incomplete, tone: "amber" },
    { label: "En instruction", value: stats.underReview },
    { label: "Entretiens à venir", value: stats.upcomingInterviews },
    { label: "Admis", value: stats.accepted, tone: "emerald" },
    {
      label: "Admissions conditionnelles",
      value: stats.conditional,
      tone: "emerald",
    },
    { label: "Liste d'attente", value: stats.waitlisted, tone: "amber" },
    { label: "Refusés", value: stats.rejected, tone: "red" },
  ];
  const toneClass: Record<string, string> = {
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    red: "text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Admissions ({applications.length})
          </h1>
          <Link
            href="/app/admissions/campaigns"
            className={btnNeutral}
          >
            Campagnes
          </Link>
        </div>
        {ok ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {errorMessage(error)}
          </div>
        ) : null}

        {/* Tableau de bord */}
        <div
          aria-label="Indicateurs des admissions"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9"
        >
          {statCards.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-zinc-100 bg-mist/40 p-3"
            >
              <div
                className={`text-xl font-bold ${toneClass[s.tone ?? ""] ?? "text-zinc-900"}`}
              >
                {s.value}
              </div>
              <div className="text-xs text-zinc-500">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-600">
          {stats.byCampaign.length ? (
            <span>
              <span className="font-semibold">Par campagne :</span>{" "}
              {stats.byCampaign.map((c) => `${c.name} (${c.count})`).join(" · ")}
            </span>
          ) : null}
          {stats.byLevel.length ? (
            <span>
              <span className="font-semibold">Par niveau :</span>{" "}
              {stats.byLevel.map((l) => `${l.name} (${l.count})`).join(" · ")}
            </span>
          ) : null}
        </div>

        <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-zinc-700">
            Campagne
            <select
              aria-label="Filtrer par campagne"
              name="campaignId"
              defaultValue={filters.campaignId ?? ""}
              className={input}
            >
              <option value="">Toutes</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Statut
            <select
              aria-label="Filtrer par statut"
              name="status"
              defaultValue={filters.status ?? ""}
              className={input}
            >
              <option value="">Tous</option>
              {Object.entries(STATUS_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Niveau
            <select
              aria-label="Filtrer par niveau"
              name="levelId"
              defaultValue={filters.levelId ?? ""}
              className={input}
            >
              <option value="">Tous</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-700">
            Recherche
            <input
              aria-label="Rechercher un dossier"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="N° dossier, nom, téléphone"
              className={input}
            />
          </label>
          <SubmitButton className={`h-9 ${btnPrimary}`}>Filtrer</SubmitButton>
        </form>
      </div>

      {/* Entretiens à venir */}
      {upcoming.length ? (
        <div className={card} aria-label="Entretiens à venir">
          <div className="text-xs font-semibold uppercase text-zinc-500">
            Entretiens et tests à venir
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {upcoming.map((iv) => (
              <li
                key={iv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2"
              >
                <span>
                  <span className="font-mono text-xs font-semibold">
                    {iv.application.fileNumber}
                  </span>{" "}
                  {iv.application.candidateFirstName}{" "}
                  {iv.application.candidateLastName} —{" "}
                  {INTERVIEW_TYPE_LABELS[iv.type]} ·{" "}
                  {fmtDT(iv.scheduledAt)}
                  {iv.location ? ` · ${iv.location}` : ""}
                </span>
                <Link
                  href={`/app/admissions?id=${iv.applicationId}`}
                  className="text-xs text-brand-700 underline"
                >
                  Ouvrir
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail ? (
        <div className={card} aria-label="Fiche candidature">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-mono text-sm font-semibold">
                {detail.application.fileNumber}
              </div>
              <div className="mt-1 text-lg font-semibold text-zinc-900">
                {detail.application.candidateFirstName}{" "}
                {detail.application.candidateLastName}
              </div>
              <div className="text-xs text-zinc-500">
                {detail.application.campaign.name} ·{" "}
                {detail.application.campaign.academicYear.name} · déposé le{" "}
                {fmt(detail.application.submittedAt)}
                {detail.application.assignedTo
                  ? ` · Instructeur : ${detail.application.assignedTo.firstName ?? ""} ${detail.application.assignedTo.lastName ?? ""}`.trim()
                  : ""}
              </div>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              {STATUS_LABELS[detail.application.status]}
            </span>
          </div>

          {detail.duplicateOf ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Doublon probable avec le dossier{" "}
              <span className="font-mono font-semibold">
                {detail.duplicateOf.fileNumber}
              </span>{" "}
              — à vérifier.
            </div>
          ) : null}
          {detail.application.infoRequestNote ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Complément demandé : {detail.application.infoRequestNote}
            </div>
          ) : null}
          {detail.application.decidedAt ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-mist/50 p-3 text-sm">
              <span className="font-semibold">Décision :</span>{" "}
              {STATUS_LABELS[detail.application.status]} — le{" "}
              {fmt(detail.application.decidedAt)}
              {detail.application.decidedBy
                ? ` par ${detail.application.decidedBy.firstName ?? ""} ${detail.application.decidedBy.lastName ?? ""}`.trim()
                : ""}
              {detail.application.decisionReason
                ? ` · Motif : ${detail.application.decisionReason}`
                : ""}
              {detail.application.decisionConditions
                ? ` · Conditions : ${detail.application.decisionConditions}`
                : ""}
              {detail.application.waitlistRank
                ? ` · Rang : ${detail.application.waitlistRank}`
                : ""}
            </div>
          ) : null}
          {capacity?.campaign.capacity != null ? (
            <div
              className={`mt-3 rounded-xl border p-3 text-sm ${
                capacity.seatsLeft === 0
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-zinc-200 bg-mist/40 text-zinc-700"
              }`}
            >
              Capacité « {capacity.campaign.name} » : {capacity.reserved}/
              {capacity.campaign.capacity} place(s) réservée(s) —{" "}
              {capacity.seatsLeft} disponible(s)
              {capacity.campaign.capacityEnforced
                ? " (plafond contraignant)"
                : " (indicatif)"}
              .
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 p-4 text-sm">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Candidat
              </div>
              <dl className="mt-2 space-y-1">
                <div>Né(e) le {fmt(detail.application.birthDate)}{detail.application.birthPlace ? ` à ${detail.application.birthPlace}` : ""}</div>
                {detail.application.sex ? <div>Sexe : {detail.application.sex === "MALE" ? "Masculin" : "Féminin"}</div> : null}
                {detail.application.previousSchool ? <div>Établissement précédent : {detail.application.previousSchool}</div> : null}
                {detail.application.targetLevel ? <div>Niveau demandé : {detail.application.targetLevel.name}</div> : null}
                {detail.application.targetClassroom ? <div>Classe souhaitée : {detail.application.targetClassroom.name}</div> : null}
                {detail.application.targetTraining ? <div>Formation : {detail.application.targetTraining}</div> : null}
                {detail.application.selfApplicant ? <div>Candidat majeur (dépôt en propre nom)</div> : null}
              </dl>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 text-sm">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Responsable
              </div>
              <dl className="mt-2 space-y-1">
                {detail.application.guardianLastName ? (
                  <div>
                    {detail.application.guardianFirstName}{" "}
                    {detail.application.guardianLastName}
                    {detail.application.guardianRelation
                      ? ` (${detail.application.guardianRelation})`
                      : ""}
                  </div>
                ) : null}
                <div>Tél. : {detail.application.guardianPhone}</div>
                {detail.application.guardianEmail ? <div>{detail.application.guardianEmail}</div> : null}
                {detail.application.guardianAddress ? <div>{detail.application.guardianAddress}</div> : null}
                {detail.application.secondaryContact ? <div>Contact secondaire : {detail.application.secondaryContact}</div> : null}
              </dl>
            </div>
          </div>

          {/* Pièces — visibles seulement avec admissions.review */}
          {detail.canReview ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Pièces jointes
              </div>
              <ul className="mt-2 space-y-1">
                {detail.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                  >
                    <span>
                      {d.label ?? d.originalName}
                      <span className="ml-2 text-xs text-zinc-500">
                        {d.category} · v{d.version} · {d.status}
                      </span>
                    </span>
                    {d.status === "ACTIVE" ? (
                      <a
                        href={`/app/admissions/pieces/${d.id}/download`}
                        className="text-xs text-brand-700 underline"
                      >
                        Télécharger
                      </a>
                    ) : null}
                  </li>
                ))}
                {detail.documents.length === 0 ? (
                  <li className="text-xs text-zinc-500">Aucune pièce.</li>
                ) : null}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-xs text-zinc-500">
              La consultation des pièces exige l&apos;habilitation
              « admissions.review ».
            </p>
          )}

          {/* Échanges avec le candidat + notes internes */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase text-zinc-500">
              Échanges et notes
            </div>
            <ul className="mt-2 space-y-1">
              {detail.application.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    m.kind === "INTERNAL_NOTE"
                      ? "border-violet-200 bg-violet-50"
                      : m.createdById
                        ? "border-sky-200 bg-sky-50"
                        : "border-emerald-200 bg-emerald-50"
                  }`}
                >
                  <span className="text-xs font-semibold">
                    {m.kind === "INTERNAL_NOTE"
                      ? "Note interne (privée)"
                      : m.kind === "APPLICANT_REPLY"
                        ? "Réponse du candidat"
                        : COMPLEMENT_LABELS[m.kind] ?? m.kind}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {m.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                  <div className="mt-0.5">{m.body}</div>
                </li>
              ))}
              {detail.application.messages.length === 0 ? (
                <li className="text-xs text-zinc-500">Aucun échange.</li>
              ) : null}
            </ul>
            {canReview ? (
              <div className="mt-3 flex flex-wrap gap-3">
                <form
                  action={requestComplementAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="id"
                    value={detail.application.id}
                  />
                  <label className="text-xs font-medium text-zinc-700">
                    Type
                    <select
                      aria-label="Type de demande"
                      name="kind"
                      className={input}
                    >
                      {Object.entries(COMPLEMENT_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Message au candidat
                    <input
                      aria-label="Message de la demande"
                      name="note"
                      required
                      placeholder="Visible dans le suivi candidat"
                      className={`${input} w-64`}
                    />
                  </label>
                  <SubmitButton className={`h-9 ${btnWarn}`}>
                    Demander un complément
                  </SubmitButton>
                </form>
                <form
                  action={addInternalNoteAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="id"
                    value={detail.application.id}
                  />
                  <label className="text-xs font-medium text-zinc-700">
                    Note interne
                    <input
                      aria-label="Note interne"
                      name="body"
                      required
                      placeholder="Jamais visible par le candidat"
                      className={`${input} w-64`}
                    />
                  </label>
                  <SubmitButton className={`h-9 ${btnNeutral}`}>
                    Ajouter la note
                  </SubmitButton>
                </form>
              </div>
            ) : null}
          </div>

          {/* Entretiens et tests */}
          {canReview ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Entretiens et tests
              </div>
              <ul className="mt-2 space-y-2">
                {detail.application.interviews.map((iv) => (
                  <li
                    key={iv.id}
                    className="rounded-lg border border-zinc-200 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {INTERVIEW_TYPE_LABELS[iv.type]} ·{" "}
                        {fmtDT(iv.scheduledAt)}
                        {iv.location ? ` · ${iv.location}` : ""}
                      </span>
                      <span className="text-xs font-semibold">
                        {INTERVIEW_STATUS_LABELS[iv.status]}
                      </span>
                    </div>
                    {iv.previousScheduledAt ? (
                      <div className="text-xs text-zinc-500">
                        Initialement prévu le {fmtDT(iv.previousScheduledAt)}
                      </div>
                    ) : null}
                    {iv.evaluatorName ? (
                      <div className="text-xs text-zinc-500">
                        Évaluateur : {iv.evaluatorName}
                      </div>
                    ) : null}
                    {iv.instructions ? (
                      <div className="mt-1 text-xs text-zinc-600">
                        Consignes candidat : {iv.instructions}
                      </div>
                    ) : null}
                    {iv.result ? (
                      <div className="mt-1 text-xs">
                        Résultat (interne) : {iv.result}
                      </div>
                    ) : null}
                    {iv.internalNote ? (
                      <div className="text-xs text-violet-700">
                        Appréciation interne : {iv.internalNote}
                      </div>
                    ) : null}
                    {iv.status === "PLANNED" ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <form
                          action={rescheduleInterviewAction}
                          className="flex items-end gap-2"
                        >
                          <input
                            type="hidden"
                            name="interviewId"
                            value={iv.id}
                          />
                          <input
                            type="hidden"
                            name="applicationId"
                            value={detail.application.id}
                          />
                          <label className="text-xs font-medium text-zinc-700">
                            Nouvelle date
                            <input
                              aria-label="Nouvelle date de l'entretien"
                              name="scheduledAt"
                              type="datetime-local"
                              defaultValue={dtlValue(iv.scheduledAt)}
                              required
                              className={input}
                            />
                          </label>
                          <SubmitButton className={`h-9 ${btnNeutral}`}>
                            Reprogrammer
                          </SubmitButton>
                        </form>
                        <form
                          action={interviewOutcomeAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input
                            type="hidden"
                            name="interviewId"
                            value={iv.id}
                          />
                          <input
                            type="hidden"
                            name="applicationId"
                            value={detail.application.id}
                          />
                          <label className="text-xs font-medium text-zinc-700">
                            Issue
                            <select
                              aria-label="Issue de l'entretien"
                              name="status"
                              className={input}
                            >
                              <option value="COMPLETED">Réalisé</option>
                              <option value="NO_SHOW">Absent</option>
                              <option value="CANCELLED">Annulé</option>
                            </select>
                          </label>
                          <label className="text-xs font-medium text-zinc-700">
                            Résultat
                            <input
                              aria-label="Résultat de l'entretien"
                              name="result"
                              placeholder="Note / résultat (interne)"
                              className={input}
                            />
                          </label>
                          <SubmitButton className={`h-9 ${btnNeutral}`}>
                            Clôturer
                          </SubmitButton>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
                {detail.application.interviews.length === 0 ? (
                  <li className="text-xs text-zinc-500">
                    Aucun entretien planifié.
                  </li>
                ) : null}
              </ul>
              {IN_REVIEW.includes(detail.application.status) ? (
                <form
                  action={scheduleInterviewAction}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="applicationId"
                    value={detail.application.id}
                  />
                  <label className="text-xs font-medium text-zinc-700">
                    Type
                    <select
                      aria-label="Type d'entretien"
                      name="type"
                      className={input}
                    >
                      {Object.entries(INTERVIEW_TYPE_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Date et heure
                    <input
                      aria-label="Date de l'entretien"
                      name="scheduledAt"
                      type="datetime-local"
                      required
                      className={input}
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Lieu / modalité
                    <input
                      aria-label="Lieu de l'entretien"
                      name="location"
                      className={input}
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Évaluateur
                    <input
                      aria-label="Évaluateur"
                      name="evaluatorName"
                      className={input}
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Consignes candidat
                    <input
                      aria-label="Consignes pour le candidat"
                      name="instructions"
                      className={input}
                    />
                  </label>
                  <SubmitButton className={`h-9 ${btnPrimary}`}>
                    Convoquer
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ) : null}

          {/* Chronologie */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase text-zinc-500">
              Chronologie
            </div>
            <ol className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3">
              {detail.application.events.map((ev) => (
                <li key={ev.id} className="text-xs text-zinc-600">
                  <span className="font-medium">
                    {STATUS_LABELS[ev.toStatus] ?? ev.toStatus}
                  </span>{" "}
                  — {ev.createdAt.toISOString().slice(0, 10)} · {ev.actorLabel}
                  {ev.note ? ` · ${ev.note}` : ""}
                </li>
              ))}
            </ol>
          </div>

          {/* Actions : instruction, affectation, décision, rotation */}
          <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              {canReview &&
              ["SUBMITTED", "ADDITIONAL_INFO_REQUIRED"].includes(
                detail.application.status,
              ) ? (
                <form action={transitionApplicationAction}>
                  <input
                    type="hidden"
                    name="id"
                    value={detail.application.id}
                  />
                  <input type="hidden" name="to" value="UNDER_REVIEW" />
                  <SubmitButton className={btnPrimary}>
                    Passer en instruction
                  </SubmitButton>
                </form>
              ) : null}
              {canReview ? (
                <form
                  action={assignInstructorAction}
                  className="flex items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="id"
                    value={detail.application.id}
                  />
                  <label className="text-xs font-medium text-zinc-700">
                    Instructeur
                    <select
                      aria-label="Affecter un instructeur"
                      name="assigneeUserId"
                      defaultValue={detail.application.assignedToId ?? ""}
                      className={input}
                    >
                      <option value="">— Non affecté —</option>
                      {assignees.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton className={`h-9 ${btnNeutral}`}>
                    Affecter
                  </SubmitButton>
                </form>
              ) : null}
              {canManage ? (
                <RotateSecretButton applicationId={detail.application.id} />
              ) : null}
            </div>

            {/* Décisions — admissions.decide uniquement */}
            {canDecide ? (
              <div className="rounded-xl border border-zinc-200 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">
                  Décision d&apos;admission
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {DECIDABLE.includes(detail.application.status) ? (
                    <>
                      <form
                        action={decideApplicationAction}
                        className="flex items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="id"
                          value={detail.application.id}
                        />
                        <input type="hidden" name="to" value="ACCEPTED" />
                        <SubmitButton className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                          Admettre
                        </SubmitButton>
                      </form>
                      <form
                        action={decideApplicationAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="id"
                          value={detail.application.id}
                        />
                        <input
                          type="hidden"
                          name="to"
                          value="CONDITIONALLY_ACCEPTED"
                        />
                        <label className="text-xs font-medium text-zinc-700">
                          Conditions requises
                          <input
                            aria-label="Conditions de l'admission"
                            name="conditions"
                            required
                            placeholder="Ex. fournir le bulletin final"
                            className={`${input} w-56`}
                          />
                        </label>
                        <SubmitButton className={`h-9 ${btnWarn}`}>
                          Admettre sous condition
                        </SubmitButton>
                      </form>
                      <form
                        action={decideApplicationAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="id"
                          value={detail.application.id}
                        />
                        <input type="hidden" name="to" value="WAITLISTED" />
                        <label className="text-xs font-medium text-zinc-700">
                          Rang (optionnel)
                          <input
                            aria-label="Rang en liste d'attente"
                            name="waitlistRank"
                            type="number"
                            min="1"
                            className={`${input} w-20`}
                          />
                        </label>
                        <label className="text-xs font-medium text-zinc-700">
                          Motif (optionnel)
                          <input
                            aria-label="Motif de la liste d'attente"
                            name="reason"
                            className={`${input} w-48`}
                          />
                        </label>
                        <SubmitButton className={`h-9 ${btnNeutral}`}>
                          Liste d&apos;attente
                        </SubmitButton>
                      </form>
                      <form
                        action={decideApplicationAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="id"
                          value={detail.application.id}
                        />
                        <input type="hidden" name="to" value="REJECTED" />
                        <label className="text-xs font-medium text-zinc-700">
                          Motif du refus (obligatoire)
                          <input
                            aria-label="Motif du refus"
                            name="reason"
                            required
                            placeholder="Visible par le candidat"
                            className={`${input} w-56`}
                          />
                        </label>
                        <SubmitButton className={`h-9 ${btnDanger}`}>
                          Refuser
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                  {REOPENABLE.includes(detail.application.status) ? (
                    <form
                      action={reopenDecisionAction}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input
                        type="hidden"
                        name="id"
                        value={detail.application.id}
                      />
                      <label className="text-xs font-medium text-zinc-700">
                        Motif du réexamen (obligatoire)
                        <input
                          aria-label="Motif du réexamen"
                          name="note"
                          required
                          className={`${input} w-56`}
                        />
                      </label>
                      <SubmitButton className={`h-9 ${btnNeutral}`}>
                        Réexaminer
                      </SubmitButton>
                    </form>
                  ) : null}
                  {detail.application.status === "CONVERTED" ? (
                    <p className="text-xs text-zinc-500">
                      Dossier converti en inscription définitive — décision
                      verrouillée.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={card}>
        <div className="overflow-x-auto">
          <table
            aria-label="Dossiers de candidature"
            className="w-full text-left text-sm"
          >
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2">Dossier</th>
                <th scope="col" className="py-2">Candidat</th>
                <th scope="col" className="py-2">Campagne</th>
                <th scope="col" className="py-2">Niveau</th>
                <th scope="col" className="py-2">Déposé le</th>
                <th scope="col" className="py-2">Statut</th>
                <th scope="col" className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 font-mono text-xs font-semibold">
                    {a.fileNumber}
                    {a.duplicateOfId ? (
                      <span className="ml-1 text-amber-700" title="Doublon probable">
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    {a.candidateFirstName} {a.candidateLastName}
                  </td>
                  <td className="py-2 text-xs">{a.campaign.name}</td>
                  <td className="py-2 text-xs">
                    {a.targetLevel?.name ?? a.targetTraining ?? "—"}
                  </td>
                  <td className="py-2 text-xs">{fmt(a.submittedAt)}</td>
                  <td className="py-2">
                    <span className="text-xs font-medium">
                      {STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/app/admissions?id=${a.id}`}
                      className="text-xs text-brand-700 underline"
                    >
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-zinc-500">
                    Aucune candidature.
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
