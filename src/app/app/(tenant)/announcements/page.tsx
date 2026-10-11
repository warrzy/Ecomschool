import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listAnnouncements } from "@/lib/services/announcements";
import {
  archiveAnnouncementAction,
  createAnnouncementAction,
  publishAnnouncementAction,
} from "@/app/app/(tenant)/announcements/actions";

export const instant = false;

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: "Tous",
  PARENTS: "Parents",
  STUDENTS: "Élèves",
  TEACHERS: "Enseignants",
};

export default async function AnnouncementsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("announcements.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "announcements.manage",
  });
  const items = await listAnnouncements({ userId: tenant.userId, schoolId: tenant.schoolId });

  const inputCls =
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Communication</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Annonces de l&apos;établissement ({items.length})
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "created" ? "Annonce créée." : ok === "published" ? "Annonce publiée (notification envoyée)." : "Annonce supprimée."}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-zinc-900">Nouvelle annonce</div>
          <form action={createAnnouncementAction} className="grid gap-3">
            <input name="title" required placeholder="Titre" className={inputCls} />
            <textarea name="body" required rows={3} placeholder="Contenu" className={inputCls} />
            <div className="flex flex-wrap items-center gap-3">
              <select name="audience" defaultValue="ALL" className={inputCls}>
                <option value="ALL">Tous</option>
                <option value="PARENTS">Parents</option>
                <option value="STUDENTS">Élèves</option>
                <option value="TEACHERS">Enseignants</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="publish" /> Publier immédiatement
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                ou programmée :
                <input type="datetime-local" name="scheduledAt" className={inputCls} />
              </label>
              <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2 pr-3">Titre</th>
              <th className="py-2 pr-3">Audience</th>
              <th className="py-2 pr-3">Statut</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100">
                <td className="py-2 pr-3 font-medium">{a.title}</td>
                <td className="py-2 pr-3">{AUDIENCE_LABELS[a.audience]}</td>
                <td className="py-2 pr-3">
                  {a.publishedAt
                    ? `Publiée le ${a.publishedAt.toLocaleDateString("fr-FR")}`
                    : a.scheduledAt
                      ? `Programmée le ${a.scheduledAt.toLocaleString("fr-FR")}`
                      : "Brouillon"}
                </td>
                <td className="py-2">
                  {canManage ? (
                    <div className="flex gap-2">
                      {!a.publishedAt ? (
                        <form action={publishAnnouncementAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                            Publier
                          </button>
                        </form>
                      ) : null}
                      <form action={archiveAnnouncementAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                          Supprimer
                        </button>
                      </form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-zinc-500">Aucune annonce.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
