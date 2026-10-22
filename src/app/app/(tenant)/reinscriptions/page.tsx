import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getReenrollmentCampaign,
  getReenrollmentRequest,
  listEligibleStudents,
  listReenrollmentCampaigns,
  listReenrollmentRequests,
  reenrollmentDashboard,
} from "@/lib/services/reenrollment";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  addReenrollNoteAction,
  batchFinalizeReenrollAction,
  cancelReenrollAction,
  createReenrollCampaignAction,
  decideReenrollAction,
  finalizeReenrollAction,
  requestReenrollInfoAction,
  reviewReenrollAction,
  setReenrollCampaignStatusAction,
  submitAdminReenrollAction,
} from "./actions";
import type { ReenrollmentRequestStatus, ReenrollmentCampaignStatus } from "@prisma/client";

export const instant = false;

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
const input = "mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm";
const btn = "rounded-lg px-3 py-2 text-sm font-medium";
const btnPrimary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const btnWarn = `${btn} border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100`;
const btnDanger = `${btn} border border-red-300 bg-red-50 text-red-800 hover:bg-red-100`;
const btnNeutral = `${btn} border border-zinc-300 bg-white text-zinc-700 hover:bg-mist`;

const STATUS_LABELS: Record<ReenrollmentRequestStatus | "NOT_STARTED", string> = {
  NOT_STARTED: "Non démarrée",
  SUBMITTED: "Déposée",
  UNDER_REVIEW: "En instruction",
  ADDITIONAL_INFO_REQUIRED: "Complément requis",
  APPROVED: "Approuvée",
  REJECTED: "Refusée",
  COMPLETED: "Finalisée",
  CANCELLED: "Annulée",
};
const CAMPAIGN_LABELS: Record<ReenrollmentCampaignStatus, string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouverte",
  CLOSED: "Fermée",
  ARCHIVED: "Archivée",
};
const PROGRESSION_LABELS: Record<string, string> = {
  PROMOTION: "Passage niveau supérieur",
  REPETITION: "Redoublement",
  SAME_LEVEL: "Maintien même niveau",
  CLASS_CHANGE: "Changement de classe",
  CYCLE_CHANGE: "Changement de cycle",
  RETURN: "Retour après interruption",
};
const BLOCKER_LABELS: Record<string, string> = {
  pieces_manquantes: "Pièces obligatoires manquantes",
  impayes: "Impayés sur l'année source",
  interruption: "Retour après interruption",
};

export default async function ReinscriptionsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("reenrollments.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const error = str("error");
  const okMsg = str("ok");
  const report = str("report");

  const [canManage, canReview, canDecide, canEnroll] = await Promise.all([
    userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: "reenrollments.manage" }),
    userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: "reenrollments.review" }),
    userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: "reenrollments.decide" }),
    userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: "enrollment.create" }),
  ]);

  const campaigns = await listReenrollmentCampaigns(ctx);
  const campId = str("camp") ?? campaigns[0]?.id;
  const campaign = campId ? await getReenrollmentCampaign(ctx, campId) : null;
  const dashboard = campaign ? await reenrollmentDashboard(ctx, campaign.id) : null;
  const eligible = campaign?.status === "OPEN" || campaign?.status === "CLOSED"
    ? await listEligibleStudents(ctx, campaign.id)
    : null;
  const statusFilter = str("status") as ReenrollmentRequestStatus | undefined;
  const requests = campaign
    ? await listReenrollmentRequests(ctx, { campaignId: campaign.id, status: statusFilter, q: str("q") })
    : [];
  const detailId = str("req");
  const detail = detailId ? await getReenrollmentRequest(ctx, detailId) : null;

  const years = await prisma.academicYear.findMany({
    where: { schoolId: ctx.schoolId },
    select: { id: true, name: true, isCurrent: true, status: true },
    orderBy: { startDate: "desc" },
  });
  const statCards = dashboard
    ? [
        { label: "Demandes", value: dashboard.total },
        { label: "Déposées", value: dashboard.submitted },
        { label: "En instruction", value: dashboard.underReview },
        { label: "Compléments", value: dashboard.infoRequired, tone: "amber" },
        { label: "Approuvées", value: dashboard.approved, tone: "emerald" },
        { label: "Finalisées", value: dashboard.completed, tone: "emerald" },
        { label: "Refusées", value: dashboard.rejected, tone: "red" },
      ]
    : [];
  const toneClass: Record<string, string> = {
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    red: "text-red-700",
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMessage(error)}
        </div>
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {okMessage(okMsg)}
        </div>
      ) : null}
      {report ? (
        <div className={`${card} !p-4`} aria-label="Rapport de traitement">
          <div className="text-xs font-semibold uppercase text-zinc-500">Rapport de traitement en masse</div>
          <ul className="mt-2 space-y-1 text-xs">
            {decodeURIComponent(report).split(",").map((r) => {
              const [outcome, , errCode] = r.split(":");
              return (
                <li key={r} className="flex gap-2">
                  <span className={
                    outcome === "SUCCESS" ? "text-emerald-700" :
                    outcome === "ALREADY" ? "text-zinc-500" :
                    outcome === "BLOCKED" ? "text-amber-700" : "text-red-700"
                  }>
                    {outcome === "SUCCESS" ? "Succès" : outcome === "ALREADY" ? "Déjà réinscrit" : outcome === "BLOCKED" ? "Bloqué" : "Échec"}
                  </span>
                  {errCode ? <span className="text-zinc-500">{errorMessage(errCode)}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-display font-bold tracking-tight text-ink">Réinscriptions</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Renouvellement annuel de la scolarité des élèves existants.
            </p>
          </div>
          {campaigns.length ? (
            <form method="GET" action="/app/reinscriptions" className="flex items-end gap-2">
              <label className="text-xs font-medium text-zinc-600">
                Campagne
                <select aria-label="Campagne" name="camp" defaultValue={campaign?.id} className={input}>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {CAMPAIGN_LABELS[c.status]}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className={`h-9 ${btnNeutral}`}>Afficher</SubmitButton>
            </form>
          ) : null}
        </div>

        {/* Création de campagne */}
        {canManage ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">
              Nouvelle campagne de réinscription
            </summary>
            <form action={createReenrollCampaignAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-zinc-600">
                Nom
                <input aria-label="Nom de la campagne" name="name" required className={`${input} w-full`} />
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Année source
                <select aria-label="Année source" name="sourceYearId" required className={`${input} w-full`}>
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (courante)" : ""}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Année cible
                <select aria-label="Année cible" name="targetYearId" required className={`${input} w-full`}>
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Ouverture
                <input aria-label="Ouverture" name="opensAt" type="date" required className={`${input} w-full`} />
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Clôture
                <input aria-label="Clôture" name="closesAt" type="date" required className={`${input} w-full`} />
              </label>
              <label className="flex items-end gap-2 text-xs font-medium text-zinc-600">
                <input type="checkbox" name="blockOnUnpaid" className="h-4 w-4" />
                Bloquer en cas d&apos;impayés
              </label>
              <label className="text-xs font-medium text-zinc-600 sm:col-span-2">
                Message aux familles
                <input aria-label="Message aux familles" name="familyMessage" className={`${input} w-full`} />
              </label>
              <div className="flex items-end">
                <SubmitButton className={btnPrimary}>Créer la campagne</SubmitButton>
              </div>
            </form>
          </details>
        ) : null}
      </div>

      {/* Campagne sélectionnée */}
      {campaign ? (
        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                {campaign.name}
                <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {CAMPAIGN_LABELS[campaign.status]}
                </span>
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {campaign.sourceYear.name} → {campaign.targetYear.name} · fenêtre{" "}
                {campaign.opensAt.toISOString().slice(0, 10)} → {campaign.closesAt.toISOString().slice(0, 10)}
                {campaign.blockOnUnpaid ? " · impayés bloquants" : ""}
              </p>
              {campaign.familyMessage ? (
                <p className="mt-1 text-xs italic text-zinc-500">« {campaign.familyMessage} »</p>
              ) : null}
            </div>
            {canManage ? (
              <div className="flex gap-2">
                {campaign.status === "DRAFT" ? (
                  <form action={setReenrollCampaignStatusAction}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="status" value="OPEN" />
                    <SubmitButton className={btnPrimary}>Ouvrir</SubmitButton>
                  </form>
                ) : null}
                {campaign.status === "OPEN" ? (
                  <form action={setReenrollCampaignStatusAction}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="status" value="CLOSED" />
                    <SubmitButton className={btnNeutral}>Fermer</SubmitButton>
                  </form>
                ) : null}
                {campaign.status !== "ARCHIVED" ? (
                  <form action={setReenrollCampaignStatusAction}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <SubmitButton className={btnDanger}>Archiver</SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Statistiques */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {statCards.map((s) => (
              <div key={s.label} className="rounded-xl border border-zinc-200 px-3 py-2">
                <div className="text-[11px] uppercase text-zinc-500">{s.label}</div>
                <div className={`text-lg font-bold ${s.tone ? toneClass[s.tone] : "text-ink"}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Élèves éligibles */}
      {campaign && eligible?.ok ? (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-ink">
              Élèves éligibles ({eligible.result.length})
            </h2>
            {canManage && campaign.status === "OPEN" ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand-700">
                  Créer une demande administrative
                </summary>
                <form action={submitAdminReenrollAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <label className="text-xs font-medium text-zinc-600">
                    Élève
                    <select aria-label="Élève" name="studentId" required className={input}>
                      <option value="">—</option>
                      {eligible.result
                        .filter((e) => !e.request)
                        .map((e) => (
                          <option key={e.studentId} value={e.studentId}>
                            {e.lastName} {e.firstName} ({e.matricule})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-600">
                    Type
                    <select aria-label="Type" name="kind" className={input}>
                      <option value="REENROLL">Réinscription</option>
                      <option value="DEPARTURE">Départ</option>
                    </select>
                  </label>
                  <SubmitButton className={`h-9 ${btnPrimary}`}>Créer</SubmitButton>
                </form>
              </details>
            ) : null}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Élèves éligibles" className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                  <th className="py-2">Élève</th>
                  <th className="py-2">Classe actuelle</th>
                  <th className="py-2">Décision annuelle</th>
                  <th className="py-2">Suggestion</th>
                  <th className="py-2">Demande</th>
                  <th className="py-2">Blocages</th>
                </tr>
              </thead>
              <tbody>
                {eligible.result.map((e) => (
                  <tr key={e.studentId} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2">
                      <Link href={`/app/students/${e.studentId}`} className="font-medium text-brand-700">
                        {e.lastName} {e.firstName}
                      </Link>
                      <div className="font-mono text-xs text-zinc-500">{e.matricule}</div>
                    </td>
                    <td className="py-2 text-xs">
                      {e.sourceClassroom ?? "—"}
                      {e.interrupted ? <span className="ml-1 text-amber-700">(interrompu)</span> : null}
                    </td>
                    <td className="py-2 text-xs">{e.annualDecision ?? "—"}</td>
                    <td className="py-2 text-xs">
                      {e.suggestion.progression ? PROGRESSION_LABELS[e.suggestion.progression] : "—"}
                      {e.suggestion.targetLevelName ? ` → ${e.suggestion.targetLevelName}` : ""}
                    </td>
                    <td className="py-2 text-xs">
                      {e.request ? (
                        <Link href={`/app/reinscriptions?camp=${campaign.id}&req=${e.request.id}`} className="text-brand-700 underline">
                          {STATUS_LABELS[e.request.status]}
                        </Link>
                      ) : (
                        <span className="text-zinc-400">{STATUS_LABELS.NOT_STARTED}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {e.blockers.map((b) => (
                        <span key={b} className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                          {BLOCKER_LABELS[b] ?? b}
                        </span>
                      ))}
                      {e.unpaidBalance > 0 ? (
                        <span className="text-xs text-zinc-500">solde {e.unpaidBalance} F</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Demandes */}
      {campaign ? (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-ink">Demandes ({requests.length})</h2>
            <form method="GET" action="/app/reinscriptions" className="flex items-end gap-2">
              <input type="hidden" name="camp" value={campaign.id} />
              <label className="text-xs font-medium text-zinc-600">
                Statut
                <select aria-label="Filtrer par statut" name="status" defaultValue={statusFilter ?? ""} className={input}>
                  <option value="">Tous</option>
                  {Object.entries(STATUS_LABELS)
                    .filter(([k]) => k !== "NOT_STARTED")
                    .map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-600">
                Recherche
                <input aria-label="Recherche" name="q" defaultValue={str("q") ?? ""} className={input} />
              </label>
              <SubmitButton className={`h-9 ${btnNeutral}`}>Filtrer</SubmitButton>
            </form>
          </div>

          <form action={batchFinalizeReenrollAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div className="mt-3 overflow-x-auto">
              <table aria-label="Demandes de réinscription" className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                    <th className="py-2"></th>
                    <th className="py-2">Élève</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Classe source</th>
                    <th className="py-2">Classe cible</th>
                    <th className="py-2">Déposée par</th>
                    <th className="py-2">Statut</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2">
                        {r.status === "APPROVED" && canDecide && canEnroll ? (
                          <input type="checkbox" name="requestIds" value={r.id} aria-label={`Sélection ${r.student.lastName}`} />
                        ) : null}
                      </td>
                      <td className="py-2">
                        {r.student.lastName} {r.student.firstName}
                        <div className="font-mono text-xs text-zinc-500">{r.student.matricule}</div>
                      </td>
                      <td className="py-2 text-xs">{r.kind === "DEPARTURE" ? "Départ" : "Réinscription"}</td>
                      <td className="py-2 text-xs">{r.sourceEnrollment?.classroom.name ?? "—"}</td>
                      <td className="py-2 text-xs">{r.targetClassroom?.name ?? "—"}</td>
                      <td className="py-2 text-xs">
                        {r.guardian ? `${r.guardian.lastName} ${r.guardian.firstName}` : "Administration"}
                      </td>
                      <td className="py-2 text-xs">{STATUS_LABELS[r.status]}</td>
                      <td className="py-2 text-right">
                        <Link href={`/app/reinscriptions?camp=${campaign.id}&req=${r.id}`} className="text-xs text-brand-700 underline">
                          Ouvrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canDecide && canEnroll && requests.some((r) => r.status === "APPROVED") ? (
              <div className="mt-3">
                <SubmitButton className={btnPrimary}>
                  Finaliser les inscriptions sélectionnées
                </SubmitButton>
                <p className="mt-1 text-xs text-zinc-500">
                  Chaque demande est traitée indépendamment : un échec n&apos;affecte pas les autres.
                </p>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}

      {/* Fiche demande */}
      {detail ? (
        <div className={card} aria-label="Fiche de réinscription">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                {detail.student.lastName} {detail.student.firstName}
                <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {STATUS_LABELS[detail.status]}
                </span>
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {detail.campaign.name} · {detail.campaign.sourceYear.name} → {detail.campaign.targetYear.name}
                {" · "}{detail.kind === "DEPARTURE" ? "Départ signalé" : "Réinscription"}
                {detail.progression ? ` · ${PROGRESSION_LABELS[detail.progression]}` : ""}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Classe source : {detail.sourceEnrollment?.classroom.name ?? "—"}
                {" · "}Souhait famille : {detail.desiredLevel?.name ?? detail.desiredClassroom?.name ?? "—"}
                {" · "}Classe cible : {detail.targetClassroom?.name ?? "—"}
              </p>
              {detail.parentNote ? (
                <p className="mt-1 text-xs italic text-zinc-600">Note famille : « {detail.parentNote} »</p>
              ) : null}
              {detail.decisionReason ? (
                <p className="mt-1 text-xs text-zinc-600">Motif : {detail.decisionReason}</p>
              ) : null}
              {detail.unpaidBalance > 0 ? (
                <p className="mt-1 text-xs text-amber-700">Solde impayé année source : {detail.unpaidBalance} FCFA</p>
              ) : null}
              {detail.blockers.length ? (
                <ul className="mt-2 space-y-1" aria-label="Blocages">
                  {detail.blockers.map((b) => (
                    <li key={b} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                      {BLOCKER_LABELS[b] ?? b}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {detail.newEnrollment ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
                <div className="font-semibold uppercase text-zinc-500">Inscription finalisée</div>
                <Link href={`/app/students/${detail.student.id}`} className="mt-1 block text-brand-700 underline">
                  Dossier élève {detail.student.matricule}
                </Link>
                <Link href={`/app/fees/accounts/${detail.student.id}`} className="mt-0.5 block text-brand-700 underline">
                  Créances
                </Link>
              </div>
            ) : null}
          </div>

          {/* Pièces (review) */}
          {canReview ? (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase text-zinc-500">Pièces déposées</h3>
              {detail.documents?.length ? (
                <ul className="mt-1 space-y-1 text-xs">
                  {detail.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span>{d.label} — {d.originalName}</span>
                      <a href={`/app/documents/${d.id}/download`} className="text-brand-700 underline">
                        Télécharger
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">Aucune pièce.</p>
              )}
              {detail.missingDocs.length ? (
                <p className="mt-1 text-xs text-amber-700">
                  Manquantes : {detail.missingDocs.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Fil */}
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase text-zinc-500">Chronologie</h3>
            <ul className="mt-1 space-y-1 text-xs">
              {detail.messages.map((m) => (
                <li key={m.id} className="border-l-2 border-zinc-200 pl-2">
                  <span className="text-zinc-500">{m.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  {" — "}
                  {m.kind === "INTERNAL_NOTE" ? "Note interne" : m.kind === "INFO_REQUEST" ? "Complément demandé" : m.kind === "APPLICANT_REPLY" ? "Réponse famille" : "Décision"}
                  {!m.visibleToParent ? " (privé)" : ""}
                  {" : "}{m.body}
                </li>
              ))}
              {!detail.messages.length ? <li className="text-zinc-500">Aucun message.</li> : null}
            </ul>
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {canReview && ["SUBMITTED", "ADDITIONAL_INFO_REQUIRED"].includes(detail.status) ? (
              <form action={reviewReenrollAction}>
                <input type="hidden" name="requestId" value={detail.id} />
                <SubmitButton className={btnNeutral}>Passer en instruction</SubmitButton>
              </form>
            ) : null}
            {canReview && ["SUBMITTED", "UNDER_REVIEW"].includes(detail.status) ? (
              <form action={requestReenrollInfoAction} className="flex items-end gap-2">
                <input type="hidden" name="requestId" value={detail.id} />
                <label className="text-xs font-medium text-zinc-700">
                  Message de la demande
                  <input aria-label="Message de la demande" name="message" required className={`${input} w-56`} />
                </label>
                <SubmitButton className={btnWarn}>Demander un complément</SubmitButton>
              </form>
            ) : null}
            {canReview ? (
              <form action={addReenrollNoteAction} className="flex items-end gap-2">
                <input type="hidden" name="requestId" value={detail.id} />
                <label className="text-xs font-medium text-zinc-700">
                  Note interne
                  <input aria-label="Note interne" name="note" required className={`${input} w-56`} />
                </label>
                <SubmitButton className={btnNeutral}>Ajouter la note</SubmitButton>
              </form>
            ) : null}
          </div>

          {canDecide && ["UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"].includes(detail.status) ? (
            <div className="mt-4 rounded-xl border border-zinc-200 p-3">
              <h3 className="text-xs font-semibold uppercase text-zinc-500">Décision</h3>
              {detail.kind === "REENROLL" ? (
                <form action={decideReenrollAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="requestId" value={detail.id} />
                  <input type="hidden" name="decision" value="APPROVED" />
                  <label className="text-xs font-medium text-zinc-700">
                    Classe cible (année {detail.campaign.targetYear.name})
                    <select aria-label="Classe cible" name="targetClassroomId" required className={input}>
                      <option value="">—</option>
                      {detail.classrooms.map((c) => (
                        <option key={c.id} value={c.id} disabled={c.seatsLeft === 0}>
                          {c.name} ({c.levelName}){c.seatsLeft != null ? ` — ${c.seatsLeft} place(s)` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    Progression
                    <select aria-label="Progression" name="progression" className={input}>
                      <option value="">— automatique —</option>
                      {Object.entries(PROGRESSION_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton className={btnPrimary}>Approuver</SubmitButton>
                </form>
              ) : (
                <form action={decideReenrollAction} className="mt-2">
                  <input type="hidden" name="requestId" value={detail.id} />
                  <input type="hidden" name="decision" value="APPROVED" />
                  <SubmitButton className={btnPrimary}>Acter le départ</SubmitButton>
                </form>
              )}
              <form action={decideReenrollAction} className="mt-2 flex items-end gap-2">
                <input type="hidden" name="requestId" value={detail.id} />
                <input type="hidden" name="decision" value="REJECTED" />
                <label className="text-xs font-medium text-zinc-700">
                  Motif du refus
                  <input aria-label="Motif du refus" name="reason" required className={`${input} w-56`} />
                </label>
                <SubmitButton className={btnDanger}>Refuser</SubmitButton>
              </form>
            </div>
          ) : null}

          {canDecide && canEnroll && detail.status === "APPROVED" && detail.kind === "REENROLL" ? (
            <form action={finalizeReenrollAction} className="mt-4">
              <input type="hidden" name="requestId" value={detail.id} />
              <SubmitButton className={btnPrimary}>
                Finaliser l&apos;inscription annuelle
              </SubmitButton>
              <p className="mt-1 text-xs text-zinc-500">
                Crée l&apos;inscription dans {detail.targetClassroom?.name ?? "la classe cible"} et génère les créances de l&apos;année cible.
              </p>
            </form>
          ) : null}

          {canReview && ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED"].includes(detail.status) ? (
            <form action={cancelReenrollAction} className="mt-3">
              <input type="hidden" name="requestId" value={detail.id} />
              <SubmitButton className={btnDanger}>Annuler la demande</SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
