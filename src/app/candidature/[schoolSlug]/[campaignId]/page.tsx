import Link from "next/link";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import {
  getPublicCampaignForm,
  getPublicSchool,
} from "@/lib/services/admissions";
import ApplicationForm from "@/app/candidature/ui/application-form";

export const instant = false;

export default async function CandidatureFormPage(props: {
  params: Promise<{ schoolSlug: string; campaignId: string }>;
}) {
  const { schoolSlug, campaignId } = await props.params;
  const school = await getPublicSchool(schoolSlug);
  if (!school) notFound();

  const data = await getPublicCampaignForm(school.id, campaignId);
  if (!data) notFound();

  const { campaign, accepting, levels, trainingOptions, requiredDocs } = data;

  return (
    <div className="min-h-full bg-mist/40">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {school.name}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
            {campaign.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Année {data.academicYearName} · clôture le{" "}
            {campaign.closesAt.toISOString().slice(0, 10)}
          </p>
          {campaign.instructions ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {campaign.instructions}
            </p>
          ) : null}
          {campaign.applicationFee ? (
            <p className="mt-2 text-xs text-zinc-600">
              Frais de candidature :{" "}
              {campaign.applicationFee.toLocaleString("fr-FR")} FCFA — à
              régler auprès de l&apos;établissement (aucun paiement en ligne
              à ce stade).
            </p>
          ) : null}
        </div>

        {accepting ? (
          <ApplicationForm
            schoolSlug={school.slug}
            campaignId={campaign.id}
            levels={levels}
            trainingOptions={trainingOptions}
            requiredDocs={requiredDocs}
          />
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 shadow-soft">
            Cette campagne n&apos;accepte pas de candidature actuellement
            (hors période d&apos;ouverture).
            <div className="mt-4">
              <Link
                href={`/candidature/${school.slug}`}
                className="text-brand-700 underline"
              >
                Retour aux campagnes
              </Link>
            </div>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
