export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Chargement">
      <div className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
      <div className="h-64 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
