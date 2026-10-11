import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { listNotifications, unreadCount } from "@/lib/services/notifications";

export const instant = false;

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requireSchoolPermission("portal.student");
  const [school, unread, notifications] = await Promise.all([
    prisma.school.findUnique({
      where: { id: tenant.schoolId },
      select: { name: true },
    }),
    unreadCount(tenant.userId),
    listNotifications(tenant.userId, { take: 5 }),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div>
          <div className="text-xs font-semibold tracking-wide text-zinc-500">ECOM-SCHOOL</div>
          <div className="text-sm font-medium text-zinc-900">Espace élève — {school?.name}</div>
        </div>
        <form action="/api/auth/signout" method="post">
          <input type="hidden" name="callbackUrl" value="/login" />
          <button className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">
            Déconnexion
          </button>
        </form>
      </header>
      {unread > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {unread} notification{unread > 1 ? "s" : ""} non lue{unread > 1 ? "s" : ""}
          {notifications[0] ? ` — ${notifications[0].title}` : ""}
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-3xl p-4">{children}</main>
    </div>
  );
}
