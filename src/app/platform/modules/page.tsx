import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { listModules } from "@/lib/services/platform/modules";
import { prisma } from "@/lib/db/prisma";

export const instant = false;

export default async function ModulesPage() {
  await requirePlatformPermission("platform.plans.read");
  const modules = await listModules();
  const planCounts = await prisma.planModule.groupBy({
    by: ["moduleId"],
    _count: true,
  });
  const countById = new Map(planCounts.map((p) => [p.moduleId, p._count]));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">
          <Link href="/platform" className="hover:underline">Plateforme</Link> / Modules
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Catalogue des modules ({modules.length})
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Les modules restreignent les permissions côté serveur — pas seulement la navigation.
          Les activations par établissement se gèrent depuis la fiche école.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2">Code</th>
              <th className="py-2">Module</th>
              <th className="py-2">Dépendances</th>
              <th className="py-2">Commercial</th>
              <th className="py-2 text-right">Offres</th>
              <th className="py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">{m.code}</td>
                <td className="py-2">
                  <div>{m.name}</div>
                  {m.description ? <div className="text-xs text-zinc-500">{m.description}</div> : null}
                </td>
                <td className="py-2 text-xs text-zinc-500">{m.dependsOn.length ? m.dependsOn.join(", ") : "—"}</td>
                <td className="py-2">{m.commercial ? "Oui" : "Non"}</td>
                <td className="py-2 text-right">{countById.get(m.id) ?? 0}</td>
                <td className="py-2">{m.status === "ACTIVE" ? "Actif" : "Archivé"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
