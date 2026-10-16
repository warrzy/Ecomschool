import Image from "next/image";

/**
 * Cadre type fenêtre de navigateur pour présenter une capture réelle.
 * Server-safe : aucune dépendance client.
 */
export default function BrowserFrame(props: {
  src: string;
  alt: string;
  url?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 ${props.className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        {props.url ? (
          <span className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-zinc-500 ring-1 ring-zinc-200">
            {props.url}
          </span>
        ) : null}
      </div>
      <Image
        src={props.src}
        alt={props.alt}
        width={1440}
        height={900}
        priority={props.priority}
        className="block h-auto w-full"
      />
    </div>
  );
}
