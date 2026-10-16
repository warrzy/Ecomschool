"use client";

export default function Error({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div aria-hidden="true" className="text-6xl font-bold text-zinc-300">Erreur</div>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900">
        Une erreur est survenue
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        Réessayez, puis contactez le support si le problème persiste.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Réessayer
      </button>
    </div>
  );
}
