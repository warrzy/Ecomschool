import { prisma } from "@/lib/db/prisma";
import { requireSchoolContext } from "@/lib/tenant/context";

export const instant = false;

export default async function DashboardPage() {
  const tenant = await requireSchoolContext();

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
    select: { name: true, city: true },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Tableau de bord</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {school ? school.name : "ECOM-SCHOOL"}
        </div>
        {school?.city ? (
          <div className="mt-1 text-sm text-zinc-600">{school.city}</div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Élèves</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">-</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Classes</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">-</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Paiements (mois)</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">-</div>
        </div>
      </div>
    </div>
  );
}
