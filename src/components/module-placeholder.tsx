export default function ModulePlaceholder({
  title,
  section,
}: {
  title: string;
  section: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">{section}</div>
        <div className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          {title}
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
        <div className="text-sm font-medium text-zinc-800">
          Module en préparation
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          Les fondations multi-tenant sont en place. Ce module sera développé
          dans une itération suivante de la Phase 2.
        </p>
      </div>
    </div>
  );
}
