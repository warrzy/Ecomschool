import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { listAuditLogs } from "@/lib/services/audit";

export const instant = false;

export default async function PlatformAuditPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.audit.read");

  const sp = (await props.searchParams) ?? {};
  const entity = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  const page = Number(typeof sp.page === "string" ? sp.page : "1") || 1;

  const { rows, total, pageSize } = await listAuditLogs({ entity, page });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Plateforme</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Journal d&apos;audit
        </h1>
        <form className="mt-4" action="/platform/audit" method="get">
          <input
            aria-label="Entité" name="entity"
            defaultValue={entity ?? ""}
            className="h-11 w-72 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            placeholder="Filtrer par entité (User, School...)"
          />
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="overflow-x-auto">
          <table aria-label="Journal d&apos;audit" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Date</th>
                <th scope="col" className="py-2 pr-4">Action</th>
                <th scope="col" className="py-2 pr-4">Entité</th>
                <th scope="col" className="py-2 pr-4">Établissement</th>
                <th scope="col" className="py-2 pr-4">Acteur</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {a.action}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.entity}
                    {a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ""}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.school?.name ?? "-"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {a.actor?.email ?? "système"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="py-6 text-zinc-500" colSpan={5}>
                    Aucun événement
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`/platform/audit?entity=${entity ?? ""}&page=${p}`}
                className={
                  p === page
                    ? "rounded-lg bg-brand-600 px-3 py-1 text-white"
                    : "rounded-lg border border-zinc-200 px-3 py-1 hover:bg-mist"
                }
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
