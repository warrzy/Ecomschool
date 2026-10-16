import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { statusLabel } from "@/lib/ui/statusLabels";

export const instant = false;

export default async function SchoolsPage() {
  const tenant = await requireSchoolPermission("school.read");

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
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
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Établissement
        </h1>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table aria-label="Établissement" className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4">Nom</th>
                <th scope="col" className="py-2 pr-4">Code</th>
                <th scope="col" className="py-2 pr-4">Ville</th>
                <th scope="col" className="py-2 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {school ? (
                <tr className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {school.name}
                  </td>
                  <td className="py-2 pr-4 text-zinc-700">{school.code}</td>
                  <td className="py-2 pr-4 text-zinc-700">{school.city ?? "-"}</td>
                  <td className="py-2 pr-4 text-zinc-700">
                    {statusLabel("school", school.status)}
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
