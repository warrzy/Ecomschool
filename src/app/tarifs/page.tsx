import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import { listPublicPlans } from "@/lib/services/platform/plans";

export const instant = false;

export const metadata: Metadata = {
  title: "Tarifs — ECOM-SCHOOL",
  description:
    "Formules d'abonnement ECOM-SCHOOL : gestion scolaire complète pour votre établissement.",
};

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} F CFA`;

export default async function TarifsPage() {
  const plans = await listPublicPlans();

  return (
    <div className="min-h-full bg-zinc-50">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Tarifs et abonnements
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600">
            Une formule adaptée à chaque établissement. Activation par
            l&apos;équipe ECOM-TOUCH après confirmation de votre demande —
            aucun paiement en ligne.
          </p>
        </div>

        {plans.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
            Les offres sont en cours de préparation — contactez ECOM-TOUCH.
          </div>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {plans.map((p) => {
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg"
                >
                  <h2 className="text-lg font-semibold text-zinc-900">
                    {p.name}
                  </h2>
                  {p.description ? (
                    <p className="mt-1 text-sm text-zinc-500">{p.description}</p>
                  ) : null}

                  <div className="mt-5">
                    <div className="text-3xl font-bold tracking-tight text-zinc-900">
                      {fmt(p.monthlyPrice)}
                      <span className="text-sm font-normal text-zinc-500">
                        {" "}
                        /mois
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-500">
                      ou {fmt(p.yearlyPrice)} /an
                    </div>
                  </div>

                  <ul className="mt-5 space-y-2 border-t border-zinc-100 pt-5 text-sm text-zinc-700">
                    <li>
                      {p.maxStudents
                        ? `Jusqu'à ${p.maxStudents.toLocaleString("fr-FR")} élèves`
                        : "Élèves illimités"}
                    </li>
                    <li>
                      {p.maxUsers
                        ? `Jusqu'à ${p.maxUsers.toLocaleString("fr-FR")} comptes utilisateurs`
                        : "Comptes utilisateurs illimités"}
                    </li>
                    {p.trialDays > 0 ? (
                      <li>Essai de {p.trialDays} jours inclus</li>
                    ) : null}
                  </ul>

                  <div className="mt-5 border-t border-zinc-100 pt-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Modules inclus
                    </div>
                    <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                      {p.modules.map((m) => (
                        <li key={m.module.code} className="flex gap-2">
                          <span className="text-emerald-600">✓</span>
                          {m.module.name}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    href={`/inscription?plan=${p.code}`}
                    className="mt-6 block h-11 rounded-xl bg-zinc-900 text-center text-sm font-semibold leading-[2.75rem] text-white transition hover:bg-zinc-800"
                  >
                    Choisir cette formule
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-center text-xs text-zinc-500">
          Prix en francs CFA (XOF). L&apos;activation de l&apos;établissement est
          confirmée par ECOM-TOUCH après réception de votre demande.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
