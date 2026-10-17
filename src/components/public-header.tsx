import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import {
  getActiveMembership,
  getActiveSchoolId,
  userHasPlatformRole,
} from "@/lib/permissions/rbac";
import { Logo } from "@/components/ui/brand";
import { MobileNav } from "@/components/ui/MobileNav";

/** Portail par rôle école ; les autres rôles (admin, finance, caisse) → /app. */
const ROLE_PORTAL: Record<string, string> = {
  TEACHER: "/teacher",
  PARENT: "/parent",
  STUDENT: "/student",
};

const NAV_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Fonctionnalités", href: "/#fonctionnalites" },
  { label: "Tarifs", href: "/tarifs" },
  { label: "Ressources", href: "/#faq" },
  { label: "À propos", href: "/#a-propos" },
];

/**
 * En-tête des pages publiques (/, /tarifs, /inscription).
 * Utilisateur connecté → « Mon espace » vers son portail ; sinon « Se connecter ».
 */
export default async function PublicHeader() {
  const session = await getSession();
  let homeHref: string | null = null;
  if (session) {
    if (await userHasPlatformRole(session.user.id)) {
      homeHref = "/platform";
    } else {
      const schoolId = await getActiveSchoolId(session.user.id);
      const roleName = schoolId
        ? (
            await getActiveMembership({
              userId: session.user.id,
              schoolId,
            })
          )?.role.name
        : null;
      homeHref = (roleName && ROLE_PORTAL[roleName]) || "/app";
    }
  }

  const mobileSections = [
    {
      items: [
        ...NAV_LINKS,
        homeHref
          ? { label: "Mon espace", href: homeHref }
          : { label: "Se connecter", href: "/login" },
        { label: "Inscrire mon établissement", href: "/inscription" },
      ],
    },
  ];

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 rounded-2xl border border-zinc-200/70 bg-white/85 px-4 shadow-soft backdrop-blur-md sm:px-5">
        <div className="flex items-center gap-2">
          <MobileNav sections={mobileSections} title="ECOM-SCHOOL" />
          <Link href="/" aria-label="ECOM-SCHOOL — accueil">
            <Logo className="[&_.brand-wordmark]:max-[420px]:hidden" />
          </Link>
        </div>

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label="Navigation principale"
        >
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="link-underline rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {homeHref ? (
            <Link
              href={homeHref}
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 sm:inline-block"
            >
              Mon espace
            </Link>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 sm:inline-block"
            >
              Se connecter
            </Link>
          )}
          <Link
            href="/inscription"
            className="btn-shine inline-flex items-center whitespace-nowrap rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-600 sm:px-4 sm:py-2 sm:text-sm"
          >
            Inscrire mon établissement
          </Link>
        </div>
      </div>
    </header>
  );
}
