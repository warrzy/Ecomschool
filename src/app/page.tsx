import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import Reveal from "@/components/marketing/reveal";
import PersonaTabs, {
  type Persona,
} from "@/components/marketing/persona-tabs";
import ScreenshotCarousel, {
  type Slide,
} from "@/components/marketing/screenshot-carousel";
import Faq, { type FaqItem } from "@/components/marketing/faq";
import {
  ArcBand,
  PaperPlane,
  Scribble,
  Sparkle,
  Trail,
} from "@/components/ui/decor";
import { listPublicPlans } from "@/lib/services/platform/plans";

export const instant = false;

export const metadata: Metadata = {
  title: "ECOM-SCHOOL — Pilotez votre établissement scolaire en toute simplicité",
  description:
    "Administration, enseignants, élèves, parents et finances : centralisez votre gestion scolaire dans une plateforme moderne, accessible et sécurisée.",
  openGraph: {
    title: "ECOM-SCHOOL — Pilotez votre établissement scolaire en toute simplicité",
    description:
      "Plateforme SaaS de gestion scolaire : élèves, enseignants, notes, finances et portails parents, développée par ECOM-TOUCH.",
    type: "website",
    locale: "fr_FR",
    images: [{ url: "/screenshots/dashboard.png", width: 1440, height: 900 }],
  },
};

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} F CFA`;

function Icon(props: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className ?? "h-5 w-5"}
    >
      <path d={props.d} />
    </svg>
  );
}

const ICONS = {
  layers: "M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z",
  wallet:
    "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4Z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z",
  chart: "M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3",
  calendar:
    "M8 2v4 M16 2v4 M3 8h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1-2-2Z",
  shield:
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  check: "M20 6 9 17l-5-5",
  arrowRight: "M5 12h14 M12 5l7 7-7 7",
};

const BENEFITS = [
  { icon: ICONS.layers, label: "Gestion centralisée", tile: "bg-mist text-brand-600" },
  { icon: ICONS.book, label: "Suivi pédagogique", tile: "bg-mint text-leaf-600" },
  { icon: ICONS.users, label: "Gestion administrative", tile: "bg-peach text-coral-500" },
  { icon: ICONS.wallet, label: "Suivi financier", tile: "bg-butter text-sun-600" },
  { icon: ICONS.chat, label: "Collaboration entre les profils", tile: "bg-mist text-brand-600" },
] as const;

/** Pastels et accents alternés — signature des cartes modules. */
const CARD_THEMES = [
  { bg: "bg-mist", tile: "bg-brand-500" },
  { bg: "bg-mint", tile: "bg-leaf-500" },
  { bg: "bg-butter", tile: "bg-sun-500" },
  { bg: "bg-peach", tile: "bg-coral-500" },
  { bg: "bg-mist", tile: "bg-brand-600" },
] as const;

const FEATURES: {
  icon: string;
  title: string;
  text: string;
  bullets: string[];
  image: string;
  alt: string;
  url: string;
}[] = [
  {
    icon: ICONS.chart,
    title: "Un tableau de bord pour piloter au quotidien",
    text: "L'administrateur visualise en un coup d'œil l'effectif, les inscriptions, la scolarité et l'activité de l'établissement, année scolaire par année scolaire.",
    bullets: [
      "Indicateurs consolidés par année scolaire",
      "Navigation par modules : référentiel, pédagogie, finances, communication",
      "Accès aux espaces selon les rôles et permissions",
    ],
    image: "/screenshots/dashboard.png",
    alt: "Tableau de bord de l'administrateur d'établissement (données fictives)",
    url: "ecomschool.fr/app",
  },
  {
    icon: ICONS.users,
    title: "Élèves, inscriptions, classes et enseignants",
    text: "Un référentiel complet : fiches élèves, parents, import CSV, inscriptions par année, niveaux, classes, salles et affectations des enseignants.",
    bullets: [
      "Création et import CSV des élèves",
      "Inscriptions liées aux classes et années scolaires",
      "Fiches enseignants et affectations pédagogiques",
    ],
    image: "/screenshots/students.png",
    alt: "Liste des inscriptions par classe et année (données fictives)",
    url: "ecomschool.fr/app/inscriptions",
  },
  {
    icon: ICONS.book,
    title: "Notes, moyennes et bulletins officiels",
    text: "Évaluations, règles de notation, calcul des moyennes et génération de bulletins versionnés avec aperçu et export PDF.",
    bullets: [
      "Saisie des évaluations par classe et par matière",
      "Bulletins publiés, versionnés et exportables en PDF",
      "Règles de notation paramétrables",
    ],
    image: "/screenshots/reports.png",
    alt: "Liste des bulletins scolaires publiés (données fictives)",
    url: "ecomschool.fr/app/bulletins",
  },
  {
    icon: ICONS.wallet,
    title: "Finances et paiements sous contrôle",
    text: "Frais de scolarité, génération des créances, encaissements, journal des paiements, impayés et configuration des catégories de frais.",
    bullets: [
      "Tableau de bord financier : facturé, encaissé, reste dû",
      "Journal des paiements et suivi des impayés",
      "Comptes élèves et catégories de frais paramétrables",
    ],
    image: "/screenshots/finance.png",
    alt: "Tableau de bord financier de l'établissement (données fictives)",
    url: "ecomschool.fr/app/finances",
  },
  {
    icon: ICONS.chat,
    title: "Communication et suivi des familles",
    text: "Annonces ciblées, messagerie interne et portails dédiés : parents et élèves consultent notes, bulletins, absences et situation financière.",
    bullets: [
      "Annonces par audience avec publication programmée",
      "Portail parent : notes, résultats, finances de l'enfant",
      "Portail élève : emploi du temps, matières, bulletins",
    ],
    image: "/screenshots/communication.png",
    alt: "Module d'annonces de l'établissement (données fictives)",
    url: "ecomschool.fr/app/annonces",
  },
];

const PERSONAS: Persona[] = [
  {
    id: "admin",
    label: "Administrateur",
    icon: <Icon d={ICONS.shield} className="h-4 w-4" />,
    title: "Pilotez tout l'établissement depuis un espace unique",
    points: [
      "Référentiel complet : années, niveaux, classes, élèves, enseignants",
      "Suivi pédagogique, financier et administratif consolidé",
      "Gestion des comptes et des accès par rôle",
    ],
    image: "/screenshots/dashboard.png",
    imageAlt: "Tableau de bord administrateur (données fictives)",
    url: "ecomschool.fr/app",
  },
  {
    id: "teacher",
    label: "Enseignant",
    icon: <Icon d={ICONS.book} className="h-4 w-4" />,
    title: "L'essentiel de la classe, sans charge administrative",
    points: [
      "Emploi du temps et classes attribuées",
      "Appels, évaluations et cahier de textes",
      "Saisie des notes intégrée au calcul des bulletins",
    ],
    image: "/screenshots/grades.png",
    imageAlt: "Espace enseignant (données fictives)",
    url: "ecomschool.fr/enseignant",
  },
  {
    id: "finance",
    label: "Responsable financier",
    icon: <Icon d={ICONS.wallet} className="h-4 w-4" />,
    title: "Une vision financière claire et actionnable",
    points: [
      "Créances générées par classe et catégorie de frais",
      "Encaissements journalisés, impayés suivis",
      "Indicateurs consolidés en temps réel",
    ],
    image: "/screenshots/finance.png",
    imageAlt: "Tableau de bord financier (données fictives)",
    url: "ecomschool.fr/app/finances",
  },
  {
    id: "parent",
    label: "Parent",
    icon: <Icon d={ICONS.users} className="h-4 w-4" />,
    title: "Suivez la scolarité de vos enfants en temps réel",
    points: [
      "Notes, résultats et bulletins publiés",
      "Absences, emploi du temps et annonces",
      "Situation financière par enfant",
    ],
    image: "/screenshots/parent.png",
    imageAlt: "Espace parent — notes publiées (données fictives)",
    url: "ecomschool.fr/parent",
  },
  {
    id: "student",
    label: "Élève",
    icon: <Icon d={ICONS.calendar} className="h-4 w-4" />,
    title: "Un espace simple pour suivre sa scolarité",
    points: [
      "Emploi du temps et matières",
      "Notes, résultats et bulletins",
      "Annonces de l'établissement",
    ],
    image: "/screenshots/student.png",
    imageAlt: "Espace élève — profil (données fictives)",
    url: "ecomschool.fr/eleve",
  },
];

const SLIDES: Slide[] = [
  {
    src: "/screenshots/dashboard.png",
    alt: "Tableau de bord administrateur",
    caption: "Tableau de bord — vue consolidée de l'établissement",
  },
  {
    src: "/screenshots/reports.png",
    alt: "Bulletins scolaires",
    caption: "Bulletins — publication et export PDF",
  },
  {
    src: "/screenshots/finance.png",
    alt: "Tableau de bord financier",
    caption: "Finances — facturé, encaissé, reste dû",
  },
  {
    src: "/screenshots/parent.png",
    alt: "Portail parent",
    caption: "Portail parent — notes et suivi de l'enfant",
  },
  {
    src: "/screenshots/student.png",
    alt: "Portail élève",
    caption: "Portail élève — profil et scolarité",
  },
];

const STEPS = [
  {
    title: "Découvrez la plateforme",
    text: "Parcourez les fonctionnalités et les formules sur le site public.",
  },
  {
    title: "Envoyez votre demande d'inscription",
    text: "Choisissez une formule et transmettez les informations de votre établissement en quelques minutes.",
  },
  {
    title: "ECOM-TOUCH vous recontacte",
    text: "Un membre de l'équipe étudie votre demande et vous accompagne dans le choix de la formule.",
  },
  {
    title: "Confirmez votre abonnement",
    text: "Le paiement est confirmé directement avec ECOM-TOUCH — aucun paiement en ligne n'est requis.",
  },
  {
    title: "Votre établissement est activé",
    text: "L'équipe crée votre espace avec l'onboarding dédié et configure votre premier compte administrateur.",
  },
  {
    title: "Vous démarrez",
    text: "Invitez vos équipes, importez vos élèves et pilotez votre année scolaire.",
  },
];

const STEP_COLORS = [
  "bg-brand-500",
  "bg-leaf-500",
  "bg-sun-500",
  "bg-coral-500",
  "bg-brand-600",
  "bg-leaf-600",
] as const;

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Comment mon établissement rejoint-il ECOM-SCHOOL ?",
    a: "Remplissez le formulaire d'inscription en choisissant une formule. Votre demande est transmise à l'équipe ECOM-TOUCH qui vous recontacte, confirme l'abonnement et active votre établissement. Aucun compte n'est créé automatiquement.",
  },
  {
    q: "Le paiement se fait-il en ligne ?",
    a: "Non. Après votre demande, ECOM-TOUCH vous contacte et le règlement s'effectue directement avec l'équipe. L'activation de votre espace intervient une fois l'abonnement confirmé.",
  },
  {
    q: "Qui peut utiliser la plateforme ?",
    a: "ECOM-SCHOOL propose des espaces dédiés : administrateur d'établissement, enseignant, responsable financier, caissier, parent et élève. Chaque utilisateur accède uniquement aux fonctions prévues pour son rôle.",
  },
  {
    q: "Les données de mon établissement sont-elles isolées ?",
    a: "Oui. Chaque établissement dispose de son propre espace : les élèves, notes, finances et utilisateurs d'une école ne sont jamais visibles par une autre.",
  },
  {
    q: "Puis-je changer de formule après la souscription ?",
    a: "Oui. L'évolution d'abonnement se fait avec l'équipe ECOM-TOUCH, qui applique le changement sur votre espace après confirmation.",
  },
  {
    q: "Que se passe-t-il en cas d'impayé ou de fin d'abonnement ?",
    a: "Les abonnements disposent d'un délai de grâce avant suspension. L'équipe ECOM-TOUCH vous accompagne pour régulariser la situation sans perdre vos données.",
  },
];

export default async function Home() {
  const plans = await listPublicPlans();

  return (
    <div className="min-h-full bg-white">
      <PublicHeader />

      {/* ------------------------------ HERO ------------------------------ */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 right-0 h-96 w-96 rounded-full bg-brand-100/70 blur-3xl" />
          <div className="absolute top-52 -left-32 h-80 w-80 rounded-full bg-butter blur-3xl" />
          <Sparkle className="absolute left-[8%] top-24 h-5 w-5 text-sun-400" />
          <Sparkle
            className="absolute bottom-16 left-[42%] h-4 w-4 text-brand-300"
            style={{ animationDelay: "1.4s" }}
          />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <div>
            <p className="hero-in inline-flex items-center gap-2 rounded-full border border-leaf-200 bg-mint px-3.5 py-1.5 text-xs font-semibold text-leaf-600">
              <span className="h-1.5 w-1.5 rounded-full bg-leaf-500" />
              Plateforme de gestion scolaire par ECOM-TOUCH
            </p>
            <h1 className="font-display mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
              <span className="line-mask">
                <span style={{ animationDelay: "80ms" }}>Pilotez votre</span>
              </span>
              <span className="line-mask">
                <span style={{ animationDelay: "200ms" }}>
                  établissement scolaire
                </span>
              </span>
              <span className="line-mask">
                <span style={{ animationDelay: "320ms" }}>
                  en toute{" "}
                  <span className="relative inline-block text-brand-600">
                    simplicité
                    <Scribble className="absolute -bottom-1.5 left-0 h-2.5 w-full" />
                  </span>
                </span>
              </span>
            </h1>
            <p
              className="hero-in mt-5 max-w-lg text-base leading-relaxed text-zinc-600"
              style={{ animationDelay: "420ms" }}
            >
              Administration, enseignants, élèves, parents et finances :
              centralisez votre gestion scolaire dans une plateforme moderne,
              accessible et sécurisée.
            </p>
            <div
              className="hero-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "540ms" }}
            >
              <Link
                href="/inscription"
                className="btn-shine group inline-flex h-12 items-center gap-2 rounded-xl bg-brand-500 px-6 text-sm font-semibold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-600"
              >
                Inscrire mon établissement
                <Icon
                  d={ICONS.arrowRight}
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="#fonctionnalites"
                className="inline-flex h-12 items-center rounded-xl border-2 border-brand-200 px-6 text-sm font-semibold text-brand-700 transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-mist"
              >
                Découvrir les fonctionnalités
              </Link>
            </div>
            <p
              className="hero-in mt-6 text-xs text-zinc-500"
              style={{ animationDelay: "660ms" }}
            >
              Activation accompagnée par ECOM-TOUCH · Sans paiement en ligne ·
              Données isolées par établissement
            </p>
          </div>

          <Reveal from="scale" className="relative">
            <div className="relative">
              <ArcBand
                aria-hidden="true"
                className="absolute -bottom-6 -left-8 -z-10 h-40 w-64 text-butter"
              />
              <div className="float-soft">
                <div className="relative overflow-hidden rounded-[2.5rem] shadow-lift">
                  <Image
                    src="/photos/hero-students.jpg"
                    alt="Élèves d'une école secondaire au Nigeria levant la main en classe — la réussite par la participation"
                    width={1600}
                    height={1068}
                    priority
                    className="block h-auto w-full object-cover"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[2.5rem] ring-1 ring-inset ring-brand-900/10"
                  />
                </div>
              </div>
              <div
                aria-hidden="true"
                className="hero-in absolute -bottom-5 -left-4 hidden rounded-2xl border border-zinc-100 bg-white/95 px-4 py-3 shadow-soft backdrop-blur lg:block"
                style={{ animationDelay: "800ms" }}
              >
                <div className="text-xs font-medium text-zinc-500">
                  Encaissé ce mois
                </div>
                <div className="mt-0.5 font-display text-lg font-bold text-ink">
                  90 000 F CFA
                </div>
              </div>
              <div
                aria-hidden="true"
                className="hero-in absolute -right-4 -top-5 hidden rounded-2xl border border-zinc-100 bg-white/95 px-4 py-3 shadow-soft backdrop-blur lg:block"
                style={{ animationDelay: "950ms" }}
              >
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint text-leaf-600">
                    <Icon d={ICONS.check} className="h-3.5 w-3.5" />
                  </span>
                  Bulletins publiés
                </div>
              </div>
              <Sparkle
                className="absolute -left-6 top-8 h-6 w-6 text-sun-400"
                style={{ animationDelay: "0.6s" }}
              />
              <PaperPlane className="float-drift absolute -right-8 bottom-10 h-6 w-6 text-brand-400" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------- BÉNÉFICES ---------------------------- */}
      <section className="border-y border-brand-100/60 bg-mist/60">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {BENEFITS.map((b, i) => (
              <Reveal key={b.label} delay={i * 90}>
                <div className="flex items-center gap-3 rounded-2xl border border-white bg-white px-4 py-3.5 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${b.tile}`}
                  >
                    <Icon d={b.icon} className="h-4.5 w-4.5" />
                  </span>
                  <span className="text-sm font-medium text-ink">{b.label}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------- FONCTIONNALITÉS ------------------------ */}
      <section id="fonctionnalites" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Tous les modules dont votre établissement a besoin
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Chaque fonctionnalité présentée ci-dessous est opérationnelle
                dans ECOM-SCHOOL — les visuels sont de vraies captures de
                l&apos;application.
              </p>
            </div>
          </Reveal>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const theme = CARD_THEMES[i % CARD_THEMES.length];
              return (
                <Reveal
                  key={f.title}
                  delay={i * 100}
                  className={i === FEATURES.length - 1 ? "lg:col-start-2" : ""}
                >
                  <article
                    className={`group flex h-full flex-col rounded-3xl p-6 shadow-soft transition duration-300 hover:-translate-y-1.5 hover:shadow-lift ${theme.bg}`}
                  >
                    <div className="relative overflow-hidden rounded-2xl">
                      <Image
                        src={f.image}
                        alt={f.alt}
                        width={1440}
                        height={900}
                        className="aspect-[16/10] w-full object-cover object-top transition duration-500 group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="mt-5 flex items-start gap-3">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${theme.tile}`}
                      >
                        <Icon d={f.icon} />
                      </span>
                      <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-ink">
                        {f.title}
                      </h3>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                      {f.text}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {f.bullets.map((b) => (
                        <li
                          key={b}
                          className="flex gap-2.5 text-sm text-zinc-700"
                        >
                          <span
                            className="mt-0.5 text-leaf-600"
                            aria-hidden="true"
                          >
                            <Icon d={ICONS.check} className="h-4 w-4" />
                          </span>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------ APERÇU ---------------------------- */}
      <section id="apercu" className="scroll-mt-24 overflow-hidden bg-mist/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Découvrez l&apos;interface en images
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Captures réelles d&apos;ECOM-SCHOOL, réalisées sur un
                établissement de démonstration aux données fictives.
              </p>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="mt-12">
              <ScreenshotCarousel slides={SLIDES} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- PERSONAS --------------------------- */}
      <section id="profils" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Une plateforme adaptée à chaque profil
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Direction, enseignants, finances, parents et élèves : chacun
                dispose d&apos;un espace pensé pour ses besoins, avec des accès
                strictement délimités.
              </p>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="mt-12">
              <PersonaTabs personas={PERSONAS} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- PARCOURS --------------------------- */}
      <section id="demarrer" className="scroll-mt-24 bg-butter/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Comment démarrer ?
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Un parcours simple et accompagné, de la découverte à
                l&apos;activation de votre établissement.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <ol className="relative mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
              {/* Trait de progression — se dessine à l'apparition (desktop). */}
              <div
                aria-hidden="true"
                className="absolute -top-1 left-0 right-0 hidden lg:block"
              >
                <Trail className="h-8 w-full" dashed />
              </div>
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 lg:block">
                  {/* Liaison verticale mobile */}
                  <div
                    aria-hidden="true"
                    className="absolute bottom-0 left-[1.35rem] top-11 w-px bg-brand-200 lg:hidden"
                  />
                  <span
                    className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ring-4 ring-white ${STEP_COLORS[i]}`}
                  >
                    {i + 1}
                  </span>
                  <div className="pt-1 lg:mt-5 lg:pt-0">
                    <h3 className="font-display text-base font-semibold text-ink">
                      {s.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                      {s.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={200}>
            <div className="mt-12 text-center">
              <Link
                href="/inscription"
                className="btn-shine inline-flex h-12 items-center gap-2 rounded-xl bg-brand-500 px-6 text-sm font-semibold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-brand-600"
              >
                Envoyer ma demande d&apos;inscription
                <Icon d={ICONS.arrowRight} className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- À PROPOS --------------------------- */}
      <section id="a-propos" className="scroll-mt-24 overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal from="left" className="relative">
              <div className="relative">
                <ArcBand
                  aria-hidden="true"
                  className="absolute -right-8 -top-6 -z-10 h-36 w-56 -scale-x-100 text-mint"
                />
                <div className="overflow-hidden rounded-[2.5rem] shadow-soft">
                  <Image
                    src="/photos/student-ghana.jpg"
                    alt="Écolier ghanéen en uniforme, souriant, cartable au dos — Tema, Ghana"
                    width={1200}
                    height={1800}
                    className="aspect-[4/5] w-full object-cover object-[center_20%]"
                  />
                </div>
                <Sparkle className="absolute -right-3 top-10 h-5 w-5 text-sun-400" />
              </div>
            </Reveal>
            <Reveal from="right" delay={120}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                  À propos d&apos;ECOM-TOUCH
                </p>
                <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                  Un partenaire de proximité pour les écoles d&apos;Afrique de
                  l&apos;Ouest
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-zinc-600">
                  ECOM-SCHOOL est conçue et opérée par ECOM-TOUCH. La plateforme
                  répond aux réalités des établissements de la région : gestion
                  administrative, pédagogique et financière centralisée, accès
                  par rôle pour toute la communauté scolaire.
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    "Activation humaine : chaque établissement est accompagné par l'équipe, pas par un automate",
                    "Données isolées et sécurisées : chaque école dispose de son propre espace",
                    "Une équipe joignable qui connaît le terrain scolaire ouest-africain",
                  ].map((t) => (
                    <li key={t} className="flex gap-3 text-sm text-zinc-700">
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint text-leaf-600"
                        aria-hidden="true"
                      >
                        <Icon d={ICONS.check} className="h-3 w-3" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------ TARIFS ---------------------------- */}
      <section id="tarifs" className="scroll-mt-24 bg-mist/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Des formules claires, adaptées à votre taille
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Les offres ci-dessous correspondent aux abonnements
                effectivement commercialisés. Activation par ECOM-TOUCH après
                validation de votre demande.
              </p>
            </div>
          </Reveal>

          <div className="mt-14 grid items-stretch gap-6 md:grid-cols-3">
            {plans.map((p, i) => {
              const featured = p.code === "PROFESSIONNEL";
              return (
                <Reveal key={p.id} delay={i * 100}>
                  <div
                    className={`relative flex h-full flex-col rounded-3xl bg-white p-6 transition duration-300 hover:-translate-y-1.5 ${
                      featured
                        ? "border-2 border-brand-500 shadow-lift lg:scale-[1.04]"
                        : "border border-zinc-200 shadow-soft hover:shadow-lift"
                    }`}
                  >
                    {featured ? (
                      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sun-400 px-3.5 py-1 text-xs font-bold text-ink shadow-sm">
                        Le plus choisi
                      </span>
                    ) : null}
                    <h3 className="font-display text-lg font-semibold text-ink">
                      {p.name}
                    </h3>
                    {p.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
                        {p.description}
                      </p>
                    ) : null}
                    <div className="mt-4">
                      <span className="font-display text-3xl font-bold tracking-tight text-ink">
                        {fmt(p.monthlyPrice)}
                      </span>
                      <span className="text-sm text-zinc-500"> /mois</span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-500">
                      ou {fmt(p.yearlyPrice)} /an
                    </div>
                    <ul className="mt-4 space-y-1.5 border-t border-zinc-100 pt-4 text-sm text-zinc-700">
                      <li>
                        {p.maxStudents
                          ? `Jusqu'à ${p.maxStudents.toLocaleString("fr-FR")} élèves`
                          : "Élèves illimités"}
                      </li>
                      <li>
                        {p.maxUsers
                          ? `Jusqu'à ${p.maxUsers.toLocaleString("fr-FR")} utilisateurs`
                          : "Utilisateurs illimités"}
                      </li>
                    </ul>
                    <Link
                      href={`/inscription?plan=${p.code}`}
                      className={`mt-5 block h-11 rounded-xl text-center text-sm font-semibold leading-[2.75rem] transition ${
                        featured
                          ? "btn-shine bg-brand-500 text-white shadow-lift hover:bg-brand-600"
                          : "border-2 border-brand-200 text-brand-700 hover:border-brand-300 hover:bg-mist"
                      }`}
                    >
                      Choisir cette formule
                    </Link>
                  </div>
                </Reveal>
              );
            })}
          </div>

          <Reveal delay={200}>
            <div className="mt-8 text-center">
              <Link
                href="/tarifs"
                className="link-underline inline-flex items-center gap-2 text-sm font-semibold text-brand-700"
              >
                Comparer les offres en détail
                <Icon d={ICONS.arrowRight} className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------- FAQ ------------------------------ */}
      <section id="faq" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Questions fréquentes
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Tout ce qu&apos;il faut savoir avant de rejoindre ECOM-SCHOOL.
              </p>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="mt-12">
              <Faq items={FAQ_ITEMS} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- CTA FINAL -------------------------- */}
      <section className="px-4 pb-20 sm:px-6">
        <Reveal from="scale">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-brand-900 text-white shadow-lift">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" />
              <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-leaf-500/20 blur-3xl" />
              <Sparkle className="absolute left-[12%] top-10 h-5 w-5 text-sun-400" />
              <Sparkle
                className="absolute bottom-12 right-[16%] h-4 w-4 text-sun-300"
                style={{ animationDelay: "1.2s" }}
              />
              <PaperPlane className="float-drift absolute right-[10%] top-12 h-7 w-7 text-white/40" />
            </div>
            <div className="relative px-6 py-20 text-center sm:px-12">
              <h2 className="font-display mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
                Prêt à moderniser la gestion de votre établissement ?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/70">
                Envoyez votre demande dès maintenant — l&apos;équipe ECOM-TOUCH
                vous recontacte pour activer votre espace.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/inscription"
                  className="btn-shine group inline-flex h-12 items-center gap-2 rounded-xl bg-sun-400 px-7 text-sm font-bold text-ink shadow-lift transition hover:-translate-y-0.5 hover:bg-sun-300"
                >
                  Inscrire mon établissement
                  <Icon
                    d={ICONS.arrowRight}
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
                <Link
                  href="/tarifs"
                  className="inline-flex h-12 items-center rounded-xl border-2 border-white/30 px-7 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/10"
                >
                  Voir les tarifs
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <PublicFooter />
    </div>
  );
}
