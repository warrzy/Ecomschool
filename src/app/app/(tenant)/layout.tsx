import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { appNav, groupNav } from "@/app/app/(tenant)/ui/nav";
import { MobileNav } from "@/components/ui/MobileNav";
import { requireSchoolContext } from "@/lib/tenant/context";
import { getSchoolPermissionKeys } from "@/lib/permissions/rbac";
import {
  getEntitlements,
  permissionCoveredByEntitlements,
} from "@/lib/services/platform/modules";
import { activeSupportSession } from "@/lib/services/platform/support";

export const instant = false;

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  cookies();
  const tenant = await requireSchoolContext();
  if (tenant.roleName === "PARENT") redirect("/parent" as never);
  if (tenant.roleName === "STUDENT") redirect("/student" as never);

  const [school, academicYear, supportSession, permKeys, ent] =
    await Promise.all([
      prisma.school.findUnique({
        where: { id: tenant.schoolId },
        select: { name: true },
      }),
      prisma.academicYear.findFirst({
        where: { schoolId: tenant.schoolId, isCurrent: true },
        select: { name: true },
      }),
      activeSupportSession(tenant.schoolId),
      getSchoolPermissionKeys({
        userId: tenant.userId,
        schoolId: tenant.schoolId,
      }),
      getEntitlements(tenant.schoolId),
    ]);

  // Menus = permissions effectives du rôle + couverture de l'abonnement,
  // exactement comme les gardes `requireSchoolPermission` des pages.
  const navSections = groupNav(
    appNav.filter(
      (item) =>
        !item.permission ||
        (permKeys.has(item.permission) &&
          permissionCoveredByEntitlements(ent, item.permission)),
    ),
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <a
        href="#contenu"
        className="sr-only z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Aller au contenu principal
      </a>
      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
          <div className="mb-6">
            <div className="text-xs font-semibold tracking-wide text-zinc-500">
              ECOM-TOUCH
            </div>
            <div className="text-lg font-semibold tracking-tight text-zinc-900">
              ECOM-SCHOOL
            </div>
          </div>

          <nav className="space-y-3 text-sm">
            {navSections.map((section) => (
              <div key={section.title}>
                <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <a
                      key={item.href}
                      className="block rounded-lg px-3 py-2 text-zinc-900 hover:bg-zinc-100"
                      href={item.href}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
            <div className="flex min-w-0 items-center gap-3">
              <MobileNav sections={navSections} />
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">Établissement</div>
                <div className="truncate text-sm font-medium text-zinc-900">
                  {school?.name ?? "-"}
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="text-xs text-zinc-500">Année</div>
                <div className="text-sm font-medium text-zinc-900">
                  {academicYear?.name ?? "-"}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/login" />
              <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">
                Déconnexion
              </button>
            </form>
            </div>
          </header>

          {supportSession ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              Session d&apos;assistance ECOM-TOUCH active — agent : {supportSession.agent.email}
              {" · "}motif : {supportSession.reason}
              {" · "}expire le {supportSession.expiresAt.toISOString().slice(0, 16).replace("T", " ")}
            </div>
          ) : null}

          <main id="contenu" className="flex-1 p-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
