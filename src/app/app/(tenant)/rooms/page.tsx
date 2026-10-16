import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listRooms } from "@/lib/services/rooms";
import { createRoomAction, updateRoomAction } from "@/app/app/(tenant)/rooms/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";

export const instant = false;

const TYPES: Record<string, string> = {
  CLASSROOM: "Classe",
  LAB: "Laboratoire",
  SCIENCE: "Salle sciences",
  SPORT: "Sport",
  ADMIN: "Administration",
  OTHER: "Autre",
};

export default async function RoomsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("rooms.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const status =
    sp.status === "ARCHIVED" ? ("ARCHIVED" as const) : ("ACTIVE" as const);
  const q = typeof sp.q === "string" ? sp.q : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "rooms.manage",
  });

  const { items, total } = await listRooms(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { status, q, pageSize: 100 },
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Salles
        </h1>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-1">
              Recherche
            </label>
            <input id="fld-src-app-app-tenant-rooms-page-tsx-1"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Code, nom, bâtiment…"
              className="h-10 w-56 rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-2">Statut</label>
            <select id="fld-src-app-app-tenant-rooms-page-tsx-2"
              name="status"
              defaultValue={status}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="ACTIVE">Disponibles</option>
              <option value="ARCHIVED">Désactivées</option>
            </select>
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
          >
            Filtrer
          </button>
        </form>
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Nouvelle salle
          </div>
          <form action={createRoomAction} className="mt-4">
            <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
            <div className="grid items-end gap-4 md:grid-cols-7">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-3">Code</label>
                <input id="fld-src-app-app-tenant-rooms-page-tsx-3"
                  name="code"
                  placeholder="S01"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-4">Nom</label>
                <input id="fld-src-app-app-tenant-rooms-page-tsx-4"
                  name="name"
                  placeholder="Salle informatique"
                  required
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-5">
                  Capacité
                </label>
                <input id="fld-src-app-app-tenant-rooms-page-tsx-5"
                  name="capacity"
                  type="number"
                  min={0}
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-6">
                  Bâtiment
                </label>
                <input id="fld-src-app-app-tenant-rooms-page-tsx-6"
                  name="building"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-7">
                  Étage
                </label>
                <input id="fld-src-app-app-tenant-rooms-page-tsx-7"
                  name="floor"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-rooms-page-tsx-8">Type</label>
                <select id="fld-src-app-app-tenant-rooms-page-tsx-8"
                  name="type"
                  defaultValue="CLASSROOM"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  {Object.entries(TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="mt-4 h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Créer
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm text-zinc-600">{total} salle(s)</div>
        <div className="overflow-x-auto">
          <table aria-label="Salles" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Code</th>
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Type</th>
                <th scope="col" className="py-2 pr-4">Capacité</th>
                <th scope="col" className="py-2 pr-4">Bâtiment</th>
                <th scope="col" className="py-2 pr-4">Étage</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
                {canManage ? <th scope="col" className="py-2 pr-4"></th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {r.code}
                  </td>
                  <td className="py-2 pr-4 text-zinc-900">{r.name}</td>
                  <td className="py-2 pr-4 text-zinc-700">{TYPES[r.type]}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {r.capacity ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {r.building ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{r.floor ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {r.status === "ACTIVE" ? "Disponible" : "Désactivée"}
                  </td>
                  {canManage ? (
                    <td className="py-2 pr-4">
                      <form action={updateRoomAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={r.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
                        >
                          {r.status === "ACTIVE" ? "Désactiver" : "Réactiver"}
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={8}>
                    Aucune salle
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
