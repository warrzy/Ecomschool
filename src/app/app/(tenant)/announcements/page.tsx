import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  countAudienceMembers,
  getAnnouncement,
  listAnnouncements,
} from "@/lib/services/announcements";
import {
  archiveAnnouncementAction,
  cancelScheduleAction,
  createAnnouncementAction,
  deleteAnnouncementAction,
  publishAnnouncementAction,
  unarchiveAnnouncementAction,
  updateAnnouncementAction,
} from "@/app/app/(tenant)/announcements/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
export const instant = false;

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: "Tous",
  PARENTS: "Parents",
  STUDENTS: "Élèves",
  TEACHERS: "Enseignants",
};

const STATUS_FILTERS = [
  ["", "Tous"],
  ["draft", "Brouillons"],
  ["scheduled", "Programmées"],
  ["published", "Publiées"],
  ["archived", "Archivées"],
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "Données invalides : le titre et le contenu sont requis.",
  MISSING_SCHEDULE:
    "Programmation : choisissez une date et une heure de publication.",
  PAST_SCHEDULE:
    "Programmation : la date choisie est déjà passée — choisissez une date future.",
  NOT_FOUND: "Annonce introuvable dans cet établissement.",
  INVALID_STATE:
    "Action impossible dans l'état actuel de l'annonce (déjà publiée, archivée ou jamais programmée).",
  FORBIDDEN:
    "Suppression refusée : seules les annonces jamais publiées peuvent être supprimées définitivement.",
  CREATE_FAILED: "La création a échoué. Réessayez.",
  UPDATE_FAILED: "L'opération a échoué. Réessayez ; si le problème persiste, contactez le support.",
};

const OK_MESSAGES: Record<string, string> = {
  created: "Brouillon enregistré — il n'est visible que par l'administration.",
  scheduled: "Annonce programmée — elle sera publiée automatiquement à la date choisie.",
  published: "Annonce publiée — les destinataires ont été notifiés.",
  updated: "Annonce modifiée.",
  unscheduled: "Programmation annulée — l'annonce est redevenue un brouillon.",
  archived: "Annonce archivée — elle n'est plus visible sur les portails mais reste consultable.",
  unarchived: "Annonce désarchivée — elle est redevenue un brouillon à modifier ou publier.",
  deleted: "Annonce supprimée définitivement.",
};

type Item = Awaited<ReturnType<typeof listAnnouncements>>[number];

function statusOf(a: Item) {
  if (a.archivedAt) return "archived" as const;
  if (a.publishedAt) return "published" as const;
  if (a.scheduledAt) return "scheduled" as const;
  return "draft" as const;
}

const STATUS_LABELS = {
  draft: "Brouillon",
  scheduled: "Programmée",
  published: "Publiée",
  archived: "Archivée",
} as const;

const STATUS_CLS = {
  draft: "bg-sky-100 text-sky-800",
  scheduled: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-zinc-100 text-zinc-600",
} as const;

function Field(props: {
  label: string;
  name: string;
  hint: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const hintId = `${props.name}-hint`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={props.name}
        className="flex items-center gap-1.5 text-sm font-medium text-zinc-800"
      >
        {props.label}
        {props.tooltip ? (
          <span
            title={props.tooltip}
            aria-label={props.tooltip}
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold text-zinc-500"
          >
            ?
          </span>
        ) : null}
      </label>
      {props.children}
      <p id={hintId} className="text-xs text-zinc-500">
        {props.hint}
      </p>
    </div>
  );
}

const btnCls =
  "rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50";
const primaryCls =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800";

export default async function AnnouncementsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("announcements.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  };
  const ok = str("ok");
  const error = str("error");
  const editId = str("edit");
  const viewId = str("view");
  const confirmKind = str("confirm");
  const confirmId = str("id");
  const fStatus = str("status") ?? "";
  const fAudience = str("audience") ?? "";

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "announcements.manage",
  });

  const items = await listAnnouncements(c, {
    includeArchived: true,
    canManage,
  });
  const filtered = items.filter((a) => {
    if (fStatus && statusOf(a) !== fStatus) return false;
    if (fAudience && a.audience !== fAudience) return false;
    return true;
  });

  const editing = editId ? items.find((a) => a.id === editId) : undefined;
  // La vue détaillée est limitée à la liste déjà filtrée par rôle :
  // un non-gestionnaire ne peut consulter que les annonces qui lui sont
  // réellement destinées (publiées, non archivées, audience correspondante).
  const viewing = viewId ? items.find((a) => a.id === viewId) : undefined;
  const confirmTarget =
    canManage && confirmKind && confirmId
      ? await getAnnouncement(c, confirmId)
      : undefined;
  const recipients =
    confirmKind === "publish" && confirmTarget
      ? await countAudienceMembers(c, confirmTarget.audience)
      : undefined;

  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";
  const linkCls =
    "font-medium text-zinc-700 underline-offset-2 hover:underline";
  const toLocal = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">Communication</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Annonces de l&apos;établissement ({items.length})
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              Les annonces publiées sont visibles sur les portails des
              destinataires et déclenchent une notification interne. Les
              brouillons et les archivées ne sont jamais visibles.
            </p>
          </div>
          <a
            href="#notice"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Comment fonctionnent les annonces ?
          </a>
        </div>
        {ok && OK_MESSAGES[ok] ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {OK_MESSAGES[ok]}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {ERROR_MESSAGES[error] ?? `Erreur : ${errorMessage(error)}`}
          </div>
        ) : null}
      </div>

      <details id="notice" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
          Comment fonctionnent les annonces ? — notice d&apos;utilisation
        </summary>
        <div className="mt-4 space-y-4 text-sm leading-6 text-zinc-600">
          <div>
            <div className="font-medium text-zinc-900">Cycle de vie</div>
            <p className="mt-1">
              Quatre états : <strong>brouillon</strong> (modifiable, jamais
              visible), <strong>programmée</strong> (publiée automatiquement à
              la date choisie par la tâche planifiée),{" "}
              <strong>publiée</strong> (visible et notifiée, contenu figé),{" "}
              <strong>archivée</strong> (retirée des portails, conservée dans
              l&apos;historique). Une programmation peut être annulée —
              l&apos;annonce redevient brouillon.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Modification</div>
            <p className="mt-1">
              Brouillons et programmées : contenu, destinataires et date
              modifiables. Publiées : contenu figé (la notification est déjà
              partie) — une annonce erronée peut être archivée puis remplacée.
              Archivées : consultation seule ; le désarchivage vers brouillon
              n&apos;est possible que si l&apos;annonce n&apos;a jamais été
              publiée.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Destinataires</div>
            <p className="mt-1">
              <strong>Tous</strong> : tous les membres actifs de
              l&apos;établissement. <strong>Parents / Élèves / Enseignants</strong> :
              uniquement le portail et les utilisateurs du groupe visé. La
              publication envoie une notification interne à chaque destinataire.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Archivage et suppression</div>
            <p className="mt-1">
              L&apos;archivage conserve l&apos;historique — c&apos;est
              l&apos;action par défaut pour retirer une annonce. La suppression
              définitive n&apos;est possible que pour les annonces jamais
              publiées (brouillons, programmations annulées, archivées non
              publiées) ; elle est irréversible.
            </p>
          </div>
        </div>
      </details>

      {/* Panneaux de confirmation */}
      {canManage && confirmTarget && confirmKind === "publish" ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-sm font-semibold text-amber-900">
            Confirmer la publication
          </div>
          <p className="mt-2 text-sm text-amber-900">
            Publier « {confirmTarget.title} » la rendra immédiatement visible
            pour l&apos;audience {AUDIENCE_LABELS[confirmTarget.audience]} et
            notifiera <strong>{recipients}</strong> membre(s) de
            l&apos;établissement. Le contenu ne sera plus modifiable.
          </p>
          <div className="mt-4 flex gap-3">
            <form action={publishAnnouncementAction}>
              <input type="hidden" name="id" value={confirmTarget.id} />
              <button type="submit" className={primaryCls}>
                Confirmer la publication
              </button>
            </form>
            <a href="/app/announcements" className={btnCls}>
              Annuler
            </a>
          </div>
        </div>
      ) : null}

      {canManage && confirmTarget && confirmKind === "archive" ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-sm font-semibold text-amber-900">
            Confirmer l&apos;archivage
          </div>
          <p className="mt-2 text-sm text-amber-900">
            Archiver « {confirmTarget.title} » la retirera des portails et
            annulera toute programmation restante. Elle restera consultable
            dans l&apos;historique.
          </p>
          <div className="mt-4 flex gap-3">
            <form action={archiveAnnouncementAction}>
              <input type="hidden" name="id" value={confirmTarget.id} />
              <button type="submit" className={primaryCls}>
                Confirmer l&apos;archivage
              </button>
            </form>
            <a href="/app/announcements" className={btnCls}>
              Annuler
            </a>
          </div>
        </div>
      ) : null}

      {canManage && confirmTarget && confirmKind === "delete" ? (
        <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-6 shadow-sm">
          <div className="text-sm font-semibold text-red-900">
            Confirmer la suppression définitive
          </div>
          <p className="mt-2 text-sm text-red-900">
            Supprimer « {confirmTarget.title} » est <strong>irréversible</strong>.
            Cette action n&apos;est possible que parce que l&apos;annonce
            n&apos;a jamais été publiée — aucun destinataire ne l&apos;a vue ou
            reçue.
          </p>
          <div className="mt-4 flex gap-3">
            <form action={deleteAnnouncementAction}>
              <input type="hidden" name="id" value={confirmTarget.id} />
              <button
                type="submit"
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
              >
                Supprimer définitivement
              </button>
            </form>
            <a href="/app/announcements" className={btnCls}>
              Annuler
            </a>
          </div>
        </div>
      ) : null}

      {/* Consultation détaillée */}
      {viewing ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                {viewing.title}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Audience : {AUDIENCE_LABELS[viewing.audience]} · Statut :{" "}
                {STATUS_LABELS[statusOf(viewing)]}
                {viewing.publishedAt
                  ? ` · publiée le ${viewing.publishedAt.toLocaleString("fr-FR")}`
                  : ""}
                {viewing.scheduledAt
                  ? ` · programmée pour le ${viewing.scheduledAt.toLocaleString("fr-FR")}`
                  : ""}
                {viewing.archivedAt
                  ? ` · archivée le ${viewing.archivedAt.toLocaleString("fr-FR")}`
                  : ""}
              </div>
            </div>
            <a href="/app/announcements" className={linkCls}>
              ← Retour à la liste
            </a>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
            {viewing.body}
          </p>
        </div>
      ) : null}

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900">
              {editing ? "Modifier l'annonce" : "Nouvelle annonce"}
            </div>
            {editing ? (
              <a href="/app/announcements" className={linkCls}>
                Annuler l&apos;édition
              </a>
            ) : null}
          </div>
          <form
            action={
              editing ? updateAnnouncementAction : createAnnouncementAction
            }
            className="grid gap-4"
          >
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            {editing ? (
              <input type="hidden" name="id" value={editing.id} />
            ) : null}
            <Field
              label="Titre"
              name="title"
              hint="Court et explicite — il apparaît dans la notification envoyée aux destinataires."
            >
              <input
                id="title"
                name="title"
                required
                defaultValue={editing?.title ?? ""}
                placeholder="Ex. Réunion parents-professeurs"
                className={inputCls}
              />
            </Field>
            <Field
              label="Contenu"
              name="body"
              hint="Texte complet visible sur les portails des destinataires après publication."
            >
              <textarea
                id="body"
                name="body"
                required
                rows={4}
                defaultValue={editing?.body ?? ""}
                placeholder="Ex. Les réunions auront lieu jeudi de 17h à 19h…"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Destinataires"
                name="audience"
                hint="Seuls les membres du groupe choisi verront l'annonce et seront notifiés."
                tooltip="« Tous » = parents, élèves, enseignants et personnel de l'établissement."
              >
                <select
                  id="audience"
                  name="audience"
                  defaultValue={editing?.audience ?? "ALL"}
                  className={inputCls}
                >
                  <option value="ALL">Tous</option>
                  <option value="PARENTS">Parents</option>
                  <option value="STUDENTS">Élèves</option>
                  <option value="TEACHERS">Enseignants</option>
                </select>
              </Field>
              <Field
                label="Date de programmation (optionnel)"
                name="scheduledAt"
                hint="Date et heure futures auxquelles l'annonce sera publiée automatiquement."
                tooltip="Ex. 2026-10-20 08:00. Laisser vide pour un brouillon ou une publication immédiate."
              >
                <input
                  id="scheduledAt"
                  type="datetime-local"
                  name="scheduledAt"
                  defaultValue={
                    editing?.scheduledAt ? toLocal(editing.scheduledAt) : ""
                  }
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              {editing ? (
                <button type="submit" className={primaryCls}>
                  Enregistrer les modifications
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    name="intent"
                    value="draft"
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Enregistrer comme brouillon
                  </button>
                  <button
                    type="submit"
                    name="intent"
                    value="schedule"
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Programmer la publication
                  </button>
                  <button type="submit" name="intent" value="publish" className={primaryCls}>
                    Enregistrer et publier
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">
            Annonces ({filtered.length})
          </div>
          <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="f-status" className="text-xs text-zinc-500">
              Statut
            </label>
            <select id="f-status" name="status" defaultValue={fStatus} className={btnCls}>
              {STATUS_FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label htmlFor="f-audience" className="text-xs text-zinc-500">
              Audience
            </label>
            <select id="f-audience" name="audience" defaultValue={fAudience} className={btnCls}>
              <option value="">Toutes</option>
              <option value="ALL">Tous</option>
              <option value="PARENTS">Parents</option>
              <option value="STUDENTS">Élèves</option>
              <option value="TEACHERS">Enseignants</option>
            </select>
            <button type="submit" className={btnCls}>
              Filtrer
            </button>
            {fStatus || fAudience ? (
              <a href="/app/announcements" className={linkCls}>
                Réinitialiser
              </a>
            ) : null}
          </form>
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Annonces de l&apos;établissement" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2 pr-3">Titre</th>
                <th scope="col" className="py-2 pr-3">Audience</th>
                <th scope="col" className="py-2 pr-3">Statut</th>
                <th scope="col" className="py-2 pr-3">Date</th>
                {canManage ? <th scope="col" className="py-2">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const st = statusOf(a);
                const neverPublished = !a.publishedAt;
                return (
                  <tr key={a.id} className="border-b border-zinc-100 align-top">
                    <td className="py-2 pr-3 font-medium">
                      <a
                        href={`/app/announcements?view=${a.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {a.title}
                      </a>
                    </td>
                    <td className="py-2 pr-3">{AUDIENCE_LABELS[a.audience]}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[st]}`}
                      >
                        {STATUS_LABELS[st]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs leading-5 text-zinc-600">
                      {a.publishedAt
                        ? `Publiée le ${a.publishedAt.toLocaleDateString("fr-FR")}`
                        : a.scheduledAt
                          ? `Pour le ${a.scheduledAt.toLocaleString("fr-FR")}`
                          : a.archivedAt
                            ? `Archivée le ${a.archivedAt.toLocaleDateString("fr-FR")}`
                            : `Créée le ${a.createdAt.toLocaleDateString("fr-FR")}`}
                    </td>
                    {canManage ? (
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {st === "draft" || st === "scheduled" ? (
                            <a
                              href={`/app/announcements?edit=${a.id}`}
                              className={linkCls}
                            >
                              Modifier
                            </a>
                          ) : null}
                          {st === "draft" || st === "scheduled" ? (
                            <a
                              href={`/app/announcements?confirm=publish&id=${a.id}`}
                              className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                            >
                              {st === "scheduled" ? "Publier maintenant" : "Publier"}
                            </a>
                          ) : null}
                          {st === "scheduled" ? (
                            <form action={cancelScheduleAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <SubmitButton pendingLabel="Annulation…" className={linkCls}>
                                Annuler prog.
                              </SubmitButton>
                            </form>
                          ) : null}
                          {st !== "archived" ? (
                            <a
                              href={`/app/announcements?confirm=archive&id=${a.id}`}
                              className="font-medium text-red-700 underline-offset-2 hover:underline"
                            >
                              Archiver
                            </a>
                          ) : null}
                          {st === "archived" && neverPublished ? (
                            <form action={unarchiveAnnouncementAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <button type="submit" className={linkCls}>
                                Désarchiver
                              </button>
                            </form>
                          ) : null}
                          {neverPublished && !a.scheduledAt ? (
                            <a
                              href={`/app/announcements?confirm=delete&id=${a.id}`}
                              className="font-medium text-red-700 underline-offset-2 hover:underline"
                            >
                              Supprimer
                            </a>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="py-6 text-center text-zinc-500">
                    Aucune annonce ne correspond aux filtres.
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
