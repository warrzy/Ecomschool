import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import { getPublicSchool } from "@/lib/services/admissions";
import TrackingForm from "@/app/candidature/ui/tracking-form";

export const instant = false;

export default async function SuiviPage(props: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await props.params;
  const school = await getPublicSchool(schoolSlug);
  if (!school) notFound();

  return (
    <div className="min-h-full bg-mist/40">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Suivi de candidature — {school.name}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Saisissez le numéro de dossier et le code de suivi reçus lors du
            dépôt. Le numéro seul ne suffit pas.
          </p>
        </div>
        <TrackingForm schoolSlug={school.slug} />
      </main>
      <PublicFooter />
    </div>
  );
}
