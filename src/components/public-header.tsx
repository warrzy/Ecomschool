import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { userHasPlatformRole } from "@/lib/permissions/rbac";

/**
 * En-tête des pages publiques (/, /tarifs, /inscription).
 * Utilisateur connecté → « Mon espace » vers son portail ; sinon « Se connecter ».
 */
export default async function PublicHeader() {
  const session = await getSession();
  const homeHref = session
    ? ((await userHasPlatformRole(session.user.id)) ? "/platform" : "/app")
    : null;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white">
            E
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-900">
            ECOM-SCHOOL
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/tarifs"
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Tarifs
          </Link>
          <Link
            href="/inscription"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 sm:inline-block"
          >
            Inscrire mon établissement
          </Link>
          {homeHref ? (
            <Link
              href={homeHref}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Mon espace
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Se connecter
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
