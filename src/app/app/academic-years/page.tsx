import { prisma } from "@/lib/db/prisma";
import { requireTenant } from "@/lib/tenant/context";
import { redirect } from "next/navigation";

export const instant = false;

export default async function AcademicYearsPage() {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  const years = await prisma.academicYear.findMany({
    where: {
      schoolId: tenant.schoolId,
    },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
      status: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Années scolaires
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Début</th>
                <th className="py-2 pr-4">Fin</th>
                <th className="py-2 pr-4">Courante</th>
                <th className="py-2 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {y.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {y.startDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {y.endDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {y.isCurrent ? "Oui" : "Non"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{y.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
