import { prisma } from "@/lib/db/prisma";
import { requireTenant } from "@/lib/tenant/context";
import { redirect } from "next/navigation";

export const instant = false;

export default async function AcademicPeriodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  const { id } = await params;

  const year = await prisma.academicYear.findFirst({
    where: {
      id,
      schoolId: tenant.schoolId,
    },
    select: { id: true, name: true },
  });

  if (!year) redirect("/app/academic-years");

  const periods = await prisma.academicPeriod.findMany({
    where: {
      academicYearId: year.id,
    },
    orderBy: { number: "asc" },
    select: {
      id: true,
      name: true,
      number: true,
      startDate: true,
      endDate: true,
      type: true,
      isLocked: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Référentiel</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Périodes - {year.name}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Nom</th>
                <th className="py-2 pr-4">Début</th>
                <th className="py-2 pr-4">Fin</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Verrouillée</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 text-zinc-700">{p.number}</td>
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {p.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {p.startDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {p.endDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{p.type}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {p.isLocked ? "Oui" : "Non"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
