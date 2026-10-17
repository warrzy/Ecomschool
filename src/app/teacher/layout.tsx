import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolContext } from "@/lib/tenant/context";
import { MobileNav } from "@/components/ui/MobileNav";
import { Sidebar } from "@/components/ui/Sidebar";

export const instant = false;

const teacherNav = [
  { label: "Tableau de bord", href: "/teacher", icon: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z" },
  { label: "Mon emploi du temps", href: "/app/schedules?view=teacher", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2" },
  { label: "Retour à l'école", href: "/app", icon: "M19 12H5 M12 19l-7-7 7-7" },
];

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requireSchoolContext();
  // Espace réservé au rôle enseignant : les autres membres de l'école
  // (admin, finances, caisse) restent sur /app.
  if (tenant.roleName !== "TEACHER") redirect("/app" as never);

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
    select: { name: true },
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <a
        href="#contenu"
        className="sr-only z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Aller au contenu principal
      </a>
      <div className="flex min-h-screen">
        <Sidebar
          sections={[{ items: teacherNav }]}
          brandTitle="Espace enseignant"
          brandSubtitle={school?.name ?? "ECOM-SCHOOL"}
          storageKey="ecomschool.nav.teacher"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
            <div className="flex min-w-0 items-center gap-3">
              <MobileNav sections={[{ items: teacherNav }]} title="Espace enseignant" />
              <div className="min-w-0 truncate text-sm font-medium text-zinc-900">
                {school?.name ?? "-"}
              </div>
            </div>
            <form action="/api/auth/signout" method="post" className="shrink-0">
              <input type="hidden" name="callbackUrl" value="/login" />
              <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">
                Déconnexion
              </button>
            </form>
          </header>
          <main id="contenu" className="flex-1 p-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
