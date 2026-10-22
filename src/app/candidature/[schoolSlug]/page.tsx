import Link from "next/link";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import {
  getPublicSchool,
  listPublicCampaigns,
} from "@/lib/services/admissions";

export const instant = false;

/**
 * Portail public de candidature d'un établissement — URL stable
 * /candidature/{slug}. Sans compte préalable. Distinct de /inscription
 * (demande B2B d'adhésion d'une école à ECOM-SCHOOL).
 */
export default async function CandidatureSchoolPage(props: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await props.params;
  const school = await getPublicSchool(schoolSlug);
  if (!school) notFound();

  const campaigns = await listPublicCampaigns(school.id);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="min-h-full bg-mist/40">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            Candidature — {school.name}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Déposez une demande d&apos;admission en ligne, sans créer de
            compte. Vous recevrez un numéro de dossier et un code de suivi
            pour suivre votre candidature.
          </p>
        </div>

        <div className="space-y-4">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    {c.name}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Année {c.academicYear} · du {fmt(c.opensAt)} au{" "}
                    {fmt(c.closesAt)}
                  </p>
                </div>
                {c.accepting ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    Ouverte
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                    Hors période
                  </span>
                )}
              </div>
              {c.description ? (
                <p className="mt-3 text-sm text-zinc-700">{c.description}</p>
              ) : null}
              {c.instructions ? (
                <p className="mt-2 text-xs text-zinc-500">{c.instructions}</p>
              ) : null}
              {c.applicationFee ? (
                <p className="mt-2 text-xs text-zinc-600">
                  Frais de candidature : {c.applicationFee.toLocaleString("fr-FR")}{" "}
                  FCFA — à régler auprès de l&apos;établissement.
                </p>
              ) : null}
              {c.accepting ? (
                <Link
                  href={`/candidature/${school.slug}/${c.id}`}
                  className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Déposer une candidature
                </Link>
              ) : null}
            </div>
          ))}
          {campaigns.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 shadow-soft">
              Aucune campagne d&apos;admission n&apos;est ouverte pour le
              moment. Revenez ultérieurement ou contactez
              l&apos;établissement.
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-soft">
            <p className="text-sm text-zinc-700">
              Vous avez déjà déposé un dossier ?
            </p>
            <Link
              href={`/candidature/${school.slug}/suivi`}
              className="mt-3 inline-block rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
            >
              Suivre ma candidature
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
