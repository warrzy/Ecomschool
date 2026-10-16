import { cookies } from "next/headers";
import { requirePlatformContext } from "@/lib/tenant/context";
import { getPlatformPermissionKeys } from "@/lib/permissions/rbac";
import { platformNav } from "@/app/platform/ui/nav";
import { MobileNav } from "@/components/ui/MobileNav";

export const instant = false;

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  cookies();
  const ctx = await requirePlatformContext();
  const permKeys = await getPlatformPermissionKeys(ctx.userId);

  const navItems = platformNav.filter(
    (item) => !item.permission || permKeys.has(item.permission),
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

          <nav className="space-y-1 text-sm">
            {navItems.map((item) => (
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
            <div className="flex min-w-0 items-center gap-3">
              <MobileNav sections={[{ items: navItems }]} title="Plateforme" />
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">Espace</div>
                <div className="truncate text-sm font-medium text-zinc-900">Plateforme</div>
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

          <main id="contenu" className="flex-1 p-4">{children}</main>
        </div>
      </div>
    </div>
  );
}
