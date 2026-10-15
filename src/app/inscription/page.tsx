import type { Metadata } from "next";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import { listPublicPlans } from "@/lib/services/platform/plans";
import SignupForm from "@/app/inscription/ui/signup-form";

export const instant = false;

export const metadata: Metadata = {
  title: "Inscrire mon établissement — ECOM-SCHOOL",
  description:
    "Demande d'inscription d'un établissement scolaire à ECOM-SCHOOL. L'équipe ECOM-TOUCH vous recontacte pour activer votre espace.",
};

export default async function InscriptionPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};
  const wanted = typeof sp.plan === "string" ? sp.plan : undefined;

  const plans = await listPublicPlans();
  const options = plans.map((p) => ({
    code: p.code,
    name: p.name,
    monthlyPrice: p.monthlyPrice,
  }));
  const selectedPlanCode = options.some((o) => o.code === wanted)
    ? wanted
    : undefined;

  return (
    <div className="min-h-full bg-zinc-50">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            Inscrire mon établissement
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Transmettez les informations de votre établissement. Un membre de
            l&apos;équipe ECOM-TOUCH vous contactera pour confirmer votre
            abonnement et activer votre espace.
          </p>
        </div>
        <SignupForm plans={options} selectedPlanCode={selectedPlanCode} />
      </main>
      <PublicFooter />
    </div>
  );
}
