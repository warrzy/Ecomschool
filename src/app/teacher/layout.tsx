import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolContext } from "@/lib/tenant/context";
import { MobileNav } from "@/components/ui/MobileNav";

export const instant = false;

const teacherNav = [
  { label: "Tableau de bord", href: "/teacher" },
  { label: "Mon emploi du temps", href: "/app/schedules?view=teacher" },
  { label: "Retour à l'école", href: "/app" },
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
      <div className="flex min-h-screen">
        <aside className="hidden w-56 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
          <div className="mb-6">
            <div className="text-xs font-semibold tracking-wide text-zinc-500">
              ECOM-SCHOOL
            </div>
            <div className="text-lg font-semibold tracking-tight text-zinc-900">
              Espace enseignant
            </div>
          </div>
          <nav className="space-y-1 text-sm">
            {teacherNav.map((item) => (
              <a
                key={item.href}
                className="block rounded-lg px-3 py-2 text-zinc-900 hover:bg-zinc-100"
                href={item.href}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
            <div className="flex items-center gap-3">
              <MobileNav sections={[{ items: teacherNav }]} title="Espace enseignant" />
              <div className="text-sm font-medium text-zinc-900">
                {school?.name ?? "-"}
              </div>
            </div>
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/login" />
              <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">
                Déconnexion
              </button>
            </form>
          </header>
          <main className="flex-1 p-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
