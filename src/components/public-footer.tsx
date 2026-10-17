import Link from "next/link";
import { Logo } from "@/components/ui/brand";

/** Pied de page des pages publiques — bandeau bleu nuit de la signature. */
export default function PublicFooter() {
  const col = "space-y-2";
  const link = "block text-sm text-white/60 transition hover:text-white";
  const head =
    "text-xs font-semibold uppercase tracking-widest text-sun-400/90";

  return (
    <footer className="bg-brand-950 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <Logo variant="dark" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
            La plateforme de gestion scolaire développée par ECOM-TOUCH, pensée
            pour les établissements d&apos;Afrique de l&apos;Ouest.
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
          <span className="block text-sm text-white/60">
            Accompagnement et activation de votre établissement.
          </span>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-white/50">
        © {new Date().getFullYear()} ECOM-TOUCH — ECOM-SCHOOL. Tous droits réservés.
      </div>
    </footer>
  );
}
