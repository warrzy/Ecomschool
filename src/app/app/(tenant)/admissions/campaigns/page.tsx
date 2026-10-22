import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  campaignLevelIds,
  campaignTrainingOptions,
  listCampaigns,
  requiredDocsOf,
} from "@/lib/services/admissions";
import { DOCUMENT_CATEGORIES } from "@/lib/services/documents";
import {
  createCampaignAction,
  setCampaignStatusAction,
  updateCampaignAction,
} from "@/app/app/(tenant)/admissions/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouverte",
  CLOSED: "Fermée",
  ARCHIVED: "Archivée",
};

const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
const input =
  "h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-brand-500";

export default async function AdmissionsCampaignsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("admissions.read");
  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "admissions.manage",
  });
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const editId = str("edit");

  const [campaigns, years, levels] = await Promise.all([
    listCampaigns({ userId: tenant.userId, schoolId: tenant.schoolId }),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true },
    }),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const editing = editId ? campaigns.find((c) => c.id === editId) : undefined;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-display font-bold tracking-tight text-ink">
          Campagnes d&apos;admission ({campaigns.length})
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Une campagne « Ouverte » et dans sa période accepte les
          candidatures publiques à l&apos;adresse{" "}
          <span className="font-mono">/candidature/&lt;slug-école&gt;</span>.
        </p>
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
      </div>

      {canManage ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">
            {editing
              ? `Modifier « ${editing.name} » (${STATUS_LABELS[editing.status]})`
              : "Nouvelle campagne"}
          </div>
          <form
            action={editing ? updateCampaignAction : createCampaignAction}
            className="grid gap-3"
          >
            {editing ? (
              <input type="hidden" name="id" value={editing.id} />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Nom *
                <input
                  aria-label="Nom de la campagne"
                  name="name"
                  required
                  defaultValue={editing?.name ?? ""}
                  className={`mt-1 ${input}`}
                  placeholder="Admissions 2026-2027"
                />
              </label>
              <label className="block text-sm">
                Année scolaire *
                <select
                  aria-label="Année scolaire"
                  name="academicYearId"
                  required
                  defaultValue={editing?.academicYearId ?? ""}
                  className={`mt-1 ${input}`}
                >
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Ouverture *
                <input
                  aria-label="Date d'ouverture"
                  name="opensAt"
                  type="date"
                  required
                  defaultValue={editing ? fmt(editing.opensAt) : ""}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="block text-sm">
                Clôture *
                <input
                  aria-label="Date de clôture"
                  name="closesAt"
                  type="date"
                  required
                  defaultValue={editing ? fmt(editing.closesAt) : ""}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="block text-sm">
                Capacité indicative
                <input
                  aria-label="Capacité"
                  name="capacity"
                  type="number"
                  min="1"
                  defaultValue={editing?.capacity ?? ""}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="block text-sm">
                Frais de candidature (FCFA)
                <input
                  aria-label="Frais de candidature"
                  name="applicationFee"
                  type="number"
                  min="0"
                  defaultValue={editing?.applicationFee ?? ""}
                  className={`mt-1 ${input}`}
                />
              </label>
            </div>
            <label className="block text-sm">
              Description
              <textarea
                aria-label="Description"
                name="description"
                rows={2}
                defaultValue={editing?.description ?? ""}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Conditions et consignes (affichées aux candidats)
              <textarea
                aria-label="Consignes"
                name="instructions"
                rows={2}
                defaultValue={editing?.instructions ?? ""}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <fieldset className="rounded-xl border border-zinc-200 p-3">
              <legend className="px-1 text-xs font-semibold text-zinc-700">
                Niveaux concernés (aucun = tous les niveaux actifs)
              </legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {levels.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="levelIds"
                      value={l.id}
                      defaultChecked={
                        editing
                          ? campaignLevelIds(editing).includes(l.id)
                          : false
                      }
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              Formations/filières proposées (une par ligne — instituts)
              <textarea
                aria-label="Formations"
                name="trainingOptions"
                rows={2}
                defaultValue={
                  editing ? campaignTrainingOptions(editing).join("\n") : ""
                }
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <fieldset className="rounded-xl border border-zinc-200 p-3">
              <legend className="px-1 text-xs font-semibold text-zinc-700">
                Pièces justificatives exigées (5 emplacements max)
              </legend>
              <div className="mt-1 space-y-2">
                {[1, 2, 3, 4, 5].map((i) => {
                  const existing = editing
                    ? requiredDocsOf(editing)[i - 1]
                    : undefined;
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        aria-label={`Pièce ${i}`}
                        name={`doc${i}_label`}
                        defaultValue={existing?.label ?? ""}
                        placeholder={`Libellé pièce ${i} (ex. Extrait de naissance)`}
                        className="h-9 flex-1 rounded-lg border border-zinc-300 px-2 text-sm"
                      />
                      <select
                        aria-label={`Catégorie pièce ${i}`}
                        name={`doc${i}_category`}
                        defaultValue={existing?.category ?? "JUSTIFICATIF"}
                        className="h-9 rounded-lg border border-zinc-300 px-2 text-sm"
                      >
                        {DOCUMENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-zinc-700">
                        <input
                          type="checkbox"
                          name={`doc${i}_required`}
                          defaultChecked={existing?.required !== false && !!existing}
                        />
                        Obligatoire
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex items-center gap-3">
              <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                {editing ? "Enregistrer" : "Créer la campagne"}
              </SubmitButton>
              {editing ? (
                <Link
                  href="/app/admissions/campaigns"
                  className="text-sm text-zinc-600 underline"
                >
                  Annuler
                </Link>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      <div className={card}>
        <div className="overflow-x-auto">
          <table
            aria-label="Campagnes d'admission"
            className="w-full text-left text-sm"
          >
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2">Campagne</th>
                <th scope="col" className="py-2">Année</th>
                <th scope="col" className="py-2">Période</th>
                <th scope="col" className="py-2">Dossiers</th>
                <th scope="col" className="py-2">Statut</th>
                <th scope="col" className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="py-2">{c.academicYear.name}</td>
                  <td className="py-2 text-xs">
                    {fmt(c.opensAt)} → {fmt(c.closesAt)}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/app/admissions?campaignId=${c.id}`}
                      className="text-brand-700 underline"
                    >
                      {c._count.applications}
                    </Link>
                  </td>
                  <td className="py-2">
                    <span
                      className={`text-xs font-medium ${
                        c.status === "OPEN"
                          ? "text-emerald-700"
                          : c.status === "CLOSED"
                            ? "text-red-700"
                            : "text-zinc-600"
                      }`}
                    >
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="flex items-center justify-end gap-2">
                      {canManage &&
                      (c.status === "DRAFT" || c.status === "OPEN") ? (
                        <Link
                          href={`/app/admissions/campaigns?edit=${c.id}`}
                          className="text-xs text-brand-700 underline"
                        >
                          Modifier
                        </Link>
                      ) : null}
                      {canManage && c.status !== "ARCHIVED" ? (
                        <form action={setCampaignStatusAction}>
                          <input type="hidden" name="id" value={c.id} />
                          {c.status === "DRAFT" ? (
                            <>
                              <input type="hidden" name="to" value="OPEN" />
                              <SubmitButton className="text-xs text-emerald-700 underline">
                                Ouvrir
                              </SubmitButton>
                            </>
                          ) : c.status === "OPEN" ? (
                            <>
                              <input type="hidden" name="to" value="CLOSED" />
                              <SubmitButton className="text-xs text-red-700 underline">
                                Fermer
                              </SubmitButton>
                            </>
                          ) : (
                            <>
                              <input type="hidden" name="to" value="ARCHIVED" />
                              <SubmitButton className="text-xs text-zinc-600 underline">
                                Archiver
                              </SubmitButton>
                            </>
                          )}
                        </form>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-zinc-500">
                    Aucune campagne.
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
