import Link from "next/link";

/** Pied de page des pages publiques. */
export default function PublicFooter() {
  const col = "space-y-2";
  const link = "block text-sm text-zinc-500 hover:text-zinc-900";
  const head = "text-xs font-semibold uppercase tracking-wide text-zinc-500";

  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white">
              E
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">
              ECOM-SCHOOL
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            La plateforme de gestion scolaire développée par ECOM-TOUCH.
          </p>
        </div>
        <div className={col}>
          <div className={head}>Produit</div>
          <Link href="/#fonctionnalites" className={link}>Fonctionnalités</Link>
          <Link href="/tarifs" className={link}>Tarifs</Link>
          <Link href="/inscription" className={link}>Inscrire mon établissement</Link>
        </div>
        <div className={col}>
          <div className={head}>Accès</div>
          <Link href="/login" className={link}>Se connecter</Link>
          <Link href="/reset-password" className={link}>Mot de passe oublié</Link>
        </div>
        <div className={col}>
          <div className={head}>ECOM-TOUCH</div>
          <a href="mailto:contact@ecomschool.fr" className={link}>
            contact@ecomschool.fr
          </a>
          <span className="block text-sm text-zinc-500">
            Accompagnement et activation de votre établissement.
          </span>
        </div>
      </div>
      <div className="border-t border-zinc-100 py-4 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} ECOM-TOUCH — ECOM-SCHOOL. Tous droits réservés.
      </div>
    </footer>
  );
}
