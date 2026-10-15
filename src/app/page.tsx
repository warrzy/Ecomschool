import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import Reveal from "@/components/marketing/reveal";
import BrowserFrame from "@/components/marketing/browser-frame";
import PersonaTabs, {
  type Persona,
} from "@/components/marketing/persona-tabs";
import ScreenshotCarousel, {
  type Slide,
} from "@/components/marketing/screenshot-carousel";
import Faq, { type FaqItem } from "@/components/marketing/faq";
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
    "M8 2v4 M16 2v4 M3 8h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  shield:
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  check: "M20 6 9 17l-5-5",
  arrowRight: "M5 12h14 M12 5l7 7-7 7",
};

const BENEFITS = [
  { icon: ICONS.layers, label: "Gestion centralisée" },
  { icon: ICONS.book, label: "Suivi pédagogique" },
  { icon: ICONS.users, label: "Gestion administrative" },
  { icon: ICONS.wallet, label: "Suivi financier" },
  { icon: ICONS.chat, label: "Collaboration entre les profils" },
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-32 right-0 h-96 w-96 rounded-full bg-emerald-100/60 blur-3xl" />
          <div className="absolute top-40 -left-32 h-80 w-80 rounded-full bg-sky-100/60 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <div>
            <p
              className="hero-in inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800"
              style={{ animationDelay: "0ms" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Plateforme de gestion scolaire par ECOM-TOUCH
            </p>
            <h1
              className="hero-in mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-zinc-900 sm:text-5xl"
              style={{ animationDelay: "120ms" }}
            >
              Pilotez votre établissement scolaire{" "}
              <span className="bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">
                en toute simplicité
              </span>
            </h1>
            <p
              className="hero-in mt-5 max-w-lg text-base leading-relaxed text-zinc-600"
              style={{ animationDelay: "240ms" }}
            >
              Administration, enseignants, élèves, parents et finances :
              centralisez votre gestion scolaire dans une plateforme moderne,
              accessible et sécurisée.
            </p>
            <div
              className="hero-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "360ms" }}
            >
              <Link
                href="/inscription"
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl"
              >
                Inscrire mon établissement
                <Icon
                  d={ICONS.arrowRight}
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="#fonctionnalites"
                className="inline-flex h-12 items-center rounded-xl border border-zinc-300 px-6 text-sm font-semibold text-zinc-800 transition hover:-translate-y-0.5 hover:border-zinc-400 hover:bg-zinc-50"
              >
                Découvrir les fonctionnalités
              </Link>
            </div>
            <p
              className="hero-in mt-6 text-xs text-zinc-500"
              style={{ animationDelay: "480ms" }}
            >
              Activation accompagnée par ECOM-TOUCH · Sans paiement en ligne ·
              Données isolées par établissement
            </p>
          </div>

          <div className="hero-in relative" style={{ animationDelay: "300ms" }}>
            <div className="float-soft">
              <BrowserFrame
                src="/screenshots/dashboard.png"
                alt="Interface réelle du tableau de bord ECOM-SCHOOL (données fictives)"
                url="ecomschool.fr/app"
                priority
              />
            </div>
            <div
              aria-hidden="true"
              className="hero-in absolute -bottom-6 -left-6 hidden rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:block"
              style={{ animationDelay: "700ms" }}
            >
              <div className="text-xs font-medium text-zinc-500">
                Encaissé ce mois
              </div>
              <div className="mt-0.5 text-lg font-bold text-zinc-900">
                90 000 F CFA
              </div>
            </div>
            <div
              aria-hidden="true"
              className="hero-in absolute -right-4 -top-6 hidden rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:block"
              style={{ animationDelay: "850ms" }}
            >
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Icon d={ICONS.check} className="h-3.5 w-3.5" />
                </span>
                Bulletins publiés
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------- BÉNÉFICES ---------------------------- */}
      <section className="border-y border-zinc-100 bg-zinc-50/70">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {BENEFITS.map((b, i) => (
              <Reveal key={b.label} delay={i * 90}>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
                    <Icon d={b.icon} className="h-4.5 w-4.5" />
                  </span>
                  <span className="text-sm font-medium text-zinc-800">
                    {b.label}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------- FONCTIONNALITÉS ------------------------ */}
      <section id="fonctionnalites" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                Tous les modules dont votre établissement a besoin
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Chaque fonctionnalité présentée ci-dessous est opérationnelle
                dans ECOM-SCHOOL — les visuels sont de vraies captures de
                l&apos;application.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 space-y-24">
            {FEATURES.map((f, i) => {
              const imageLeft = i % 2 === 0;
              return (
                <div
                  key={f.title}
                  className="grid items-center gap-10 lg:grid-cols-2"
                >
                  <Reveal
                    from={imageLeft ? "left" : "right"}
                    className={imageLeft ? "" : "lg:order-2"}
                  >
                    <BrowserFrame src={f.image} alt={f.alt} url={f.url} />
                  </Reveal>
                  <Reveal
                    from={imageLeft ? "right" : "left"}
                    className={imageLeft ? "" : "lg:order-1"}
                    delay={120}
                  >
                    <div>
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-white">
                        <Icon d={f.icon} />
                      </span>
                      <h3 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">
                        {f.title}
                      </h3>
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
                              className="mt-0.5 text-emerald-600"
                              aria-hidden="true"
                            >
                              <Icon d={ICONS.check} className="h-4 w-4" />
                            </span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------- PERSONAS --------------------------- */}
      <section id="profils" className="scroll-mt-20 bg-zinc-50/70">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
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

      {/* ------------------------------ APERÇU ---------------------------- */}
      <section id="apercu" className="scroll-mt-20 overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
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

      {/* ----------------------------- PARCOURS --------------------------- */}
      <section id="demarrer" className="scroll-mt-20 bg-zinc-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">
                Comment démarrer ?
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Un parcours simple et accompagné, de la découverte à
                l&apos;activation de votre établissement.
              </p>
            </div>
          </Reveal>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 80}>
                <div className="group relative h-full rounded-2xl border border-zinc-700/60 bg-zinc-800/50 p-6 transition duration-300 hover:-translate-y-1 hover:border-zinc-600 hover:bg-zinc-800">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-400 ring-1 ring-emerald-500/40 transition group-hover:bg-emerald-500/25">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {s.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200}>
            <div className="mt-10 text-center">
              <Link
                href="/inscription"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-900 transition hover:-translate-y-0.5 hover:bg-zinc-100"
              >
                Envoyer ma demande d&apos;inscription
                <Icon d={ICONS.arrowRight} className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------ TARIFS ---------------------------- */}
      <section id="tarifs" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                Des formules claires, adaptées à votre taille
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                Les offres ci-dessous correspondent aux abonnements
                effectivement commercialisés. Activation par ECOM-TOUCH après
                validation de votre demande.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {plans.map((p, i) => (
              <Reveal key={p.id} delay={i * 100}>
                <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <h3 className="text-lg font-semibold text-zinc-900">
                    {p.name}
                  </h3>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
                      {p.description}
                    </p>
                  ) : null}
                  <div className="mt-4">
                    <span className="text-3xl font-bold tracking-tight text-zinc-900">
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
                    className="mt-5 block h-11 rounded-xl border border-zinc-300 text-center text-sm font-semibold leading-[2.75rem] text-zinc-900 transition hover:bg-zinc-50"
                  >
                    Choisir cette formule
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200}>
            <div className="mt-8 text-center">
              <Link
                href="/tarifs"
                className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 underline-offset-4 hover:underline"
              >
                Comparer les offres en détail
                <Icon d={ICONS.arrowRight} className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------- FAQ ------------------------------ */}
      <section id="faq" className="scroll-mt-20 bg-zinc-50/70">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
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
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-100/70 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Prêt à moderniser la gestion de votre établissement ?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-600">
              Envoyez votre demande dès maintenant — l&apos;équipe ECOM-TOUCH
              vous recontacte pour activer votre espace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/inscription"
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-zinc-900 px-7 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl"
              >
                Inscrire mon établissement
                <Icon
                  d={ICONS.arrowRight}
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/tarifs"
                className="inline-flex h-12 items-center rounded-xl border border-zinc-300 px-7 text-sm font-semibold text-zinc-800 transition hover:-translate-y-0.5 hover:border-zinc-400 hover:bg-zinc-50"
              >
                Voir les tarifs
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
