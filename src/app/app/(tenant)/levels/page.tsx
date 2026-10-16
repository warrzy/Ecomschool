import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listLevels } from "@/lib/services/classes";
import {
  createLevelAction,
  updateLevelAction,
} from "@/app/app/(tenant)/levels/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";

export const instant = false;

export default async function LevelsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("classroom.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const showArchived = sp.archived === "1";

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "classroom.manage",
  });

  const levels = await listLevels(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    showArchived,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Niveaux
        </div>
        <div className="mt-1 text-sm text-zinc-600">
          Exemples configurables : CP1, CE2, 6e, Terminale…
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">Nouveau niveau</div>
          <form
            action={createLevelAction}
            className="mt-4 flex flex-wrap items-end gap-4"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Nom</label>
              <input
                name="name"
                placeholder="6e"
                required
                className="h-11 w-48 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-800">Ordre</label>
              <input
                name="order"
                type="number"
                min={0}
                defaultValue={0}
                className="h-11 w-28 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Créer
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-900">
            {levels.length} niveau{levels.length > 1 ? "x" : ""}
          </div>
          <a
            href={showArchived ? "/app/levels" : "/app/levels?archived=1"}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            {showArchived ? "Masquer les archivés" : "Voir les archivés"}
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Ordre</th>
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Classes</th>
                <th className="py-2 pr-4">Statut</th>
                {canManage ? <th className="py-2 pr-4">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 text-zinc-700">{l.order}</td>
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {l.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {l._count.classrooms}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {statusLabel("level", l.status)}
                  </td>
                  {canManage ? (
                    <td className="py-2 pr-4">
                      <form
                        action={updateLevelAction}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="order" value={l.order} />
                        <input
                          type="hidden"
                          name="status"
                          value={l.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                        >
                          {l.status === "ACTIVE" ? "Archiver" : "Réactiver"}
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
              {levels.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={5}>
                    Aucun niveau
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
