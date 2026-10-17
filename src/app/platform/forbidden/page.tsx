export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div aria-hidden="true" className="text-6xl font-bold text-zinc-300">403</div>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900">Accès refusé</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Vous n&apos;avez pas les droits nécessaires pour consulter cette page
        de l&apos;administration plateforme.
      </p>
      <a
        href="/platform"
        className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Retour à la vue générale
      </a>
    </div>
  );
}
