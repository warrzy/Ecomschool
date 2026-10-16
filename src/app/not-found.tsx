import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="max-w-lg text-center">
        <div aria-hidden="true" className="text-6xl font-bold text-zinc-300">404</div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">
          Page introuvable
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          La page demandée n&apos;existe pas ou a été déplacée.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
