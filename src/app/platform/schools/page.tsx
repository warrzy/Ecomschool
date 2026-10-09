import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant/context";

export const instant = false;

export default async function PlatformSchoolsPage() {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login" as never);
  if (!tenant.isSuperAdmin) redirect("/app" as never);

  const schools = await prisma.school.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      status: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Établissements
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Ville</th>
                <th className="py-2 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {s.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{s.code}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.city ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
