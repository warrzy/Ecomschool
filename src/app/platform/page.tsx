import { prisma } from "@/lib/db/prisma";
import { requirePlatformContext } from "@/lib/tenant/context";

export const instant = false;

export default async function PlatformDashboard() {
  await requirePlatformContext();

  const [schoolCount, userCount, membershipCount] = await Promise.all([
    prisma.school.count(),
    prisma.user.count(),
    prisma.schoolMembership.count({ where: { status: "ACTIVE" } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Tableau de bord</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Plateforme
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Établissements</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {schoolCount}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Utilisateurs</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {userCount}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Memberships actifs</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">
            {membershipCount}
          </div>
        </div>
      </div>
    </div>
  );
}
