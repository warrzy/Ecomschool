export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="text-6xl font-bold text-zinc-300">404</div>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900">
        Page introuvable
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        La page demandée n&apos;existe pas ou a été déplacée.
      </p>
      <a
        href="/app"
        className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Retour au tableau de bord
      </a>
    </div>
  );
}
