/**
 * Notices d'utilisation intégrées — même présentation que les blocs
 * « Comment ça marche ? » déjà en place (ex. /app/announcements,
 * /app/grading-policy) : un lien vers l'ancre #notice en en-tête et un
 * bloc <details> repliable dans la page.
 */
export function HelpLink({
  href = "#notice",
  children = "Comment ça marche ?",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
    >
      {children}
    </a>
  );
}

export function Notice({
  title,
  children,
}: {
  /** Titre affiché dans le résumé du bloc repliable. */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id="notice"
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
        {title}
      </summary>
      <div className="mt-4 space-y-4 text-sm leading-6 text-zinc-600">
        {children}
      </div>
    </details>
  );
}

/** Une rubrique de notice : titre + paragraphe. */
export function NoticeSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-medium text-zinc-900">{title}</div>
      <p className="mt-1">{children}</p>
    </div>
  );
}
