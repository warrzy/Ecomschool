import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50">
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
            <a className="block rounded-lg px-3 py-2 text-zinc-900 hover:bg-zinc-100" href="/app">
              Tableau de bord
            </a>
          </nav>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
            <div className="text-sm text-zinc-700">Établissement actif</div>
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
