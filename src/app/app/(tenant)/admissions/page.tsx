import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getApplicationDetail,
  listApplications,
  listCampaigns,
} from "@/lib/services/admissions";
import { transitionApplicationAction } from "@/app/app/(tenant)/admissions/actions";
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

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";

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

  const [canReview, canManage] = await Promise.all([
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
  ]);

  const [applications, campaigns, levels] = await Promise.all([
    listApplications(ctx, filters),
    listCampaigns(ctx),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const detail = detailId ? await getApplicationDetail(ctx, detailId) : null;
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Admissions ({applications.length})
          </h1>
          <Link
            href="/app/admissions/campaigns"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
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

        <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-zinc-700">
            Campagne
            <select
              aria-label="Filtrer par campagne"
              name="campaignId"
              defaultValue={filters.campaignId ?? ""}
              className="mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm"
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
              className="mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm"
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
              className="mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm"
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
              className="mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm"
            />
          </label>
          <SubmitButton className="h-9 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
            Filtrer
          </SubmitButton>
        </form>
      </div>

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

          {/* Actions G2-B : instruction légère + rotation du code */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
            {canReview &&
            ["SUBMITTED", "ADDITIONAL_INFO_REQUIRED"].includes(
              detail.application.status,
            ) ? (
              <form action={transitionApplicationAction}>
                <input type="hidden" name="id" value={detail.application.id} />
                <input type="hidden" name="to" value="UNDER_REVIEW" />
                <SubmitButton className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                  Passer en instruction
                </SubmitButton>
              </form>
            ) : null}
            {canReview &&
            ["SUBMITTED", "UNDER_REVIEW"].includes(
              detail.application.status,
            ) ? (
              <form
                action={transitionApplicationAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="id" value={detail.application.id} />
                <input
                  type="hidden"
                  name="to"
                  value="ADDITIONAL_INFO_REQUIRED"
                />
                <label className="text-xs font-medium text-zinc-700">
                  Complément demandé
                  <input
                    aria-label="Motif du complément"
                    name="note"
                    required
                    placeholder="Ex. extrait de naissance illisible"
                    className="mt-1 block h-9 w-64 rounded-lg border border-zinc-300 px-2 text-sm"
                  />
                </label>
                <SubmitButton className="h-9 rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100">
                  Demander un complément
                </SubmitButton>
              </form>
            ) : null}
            {canManage ? (
              <RotateSecretButton applicationId={detail.application.id} />
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
