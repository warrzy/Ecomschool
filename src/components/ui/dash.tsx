import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Composants de pilotage ECOM-SCHOOL (lot D4).
 * Server-safe : aucun état client, animations CSS only (reveal/hover).
 * Palette : tokens D1 (brand/ink/pastels), accents sun/leaf/coral.
 */

export type DashTone = "brand" | "sun" | "leaf" | "coral" | "mist";

const TONE_ICON: Record<DashTone, string> = {
  brand: "bg-brand-100 text-brand-700",
  sun: "bg-butter text-amber-700",
  leaf: "bg-mint text-emerald-700",
  coral: "bg-peach text-orange-700",
  mist: "bg-mist text-brand-700",
};

export function DashIcon(props: { d: string; tone?: DashTone }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE_ICON[props.tone ?? "brand"]}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d={props.d} />
      </svg>
    </span>
  );
}

/** Carte KPI : indicateur, libellé, icône, évolution/hint optionnels. */
export function KpiCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  tone?: DashTone;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {props.label}
          </div>
          <div className="font-display mt-1.5 text-2xl font-bold tracking-tight text-ink">
            {props.value}
          </div>
          {props.hint ? (
            <div className="mt-1 text-xs text-zinc-500">{props.hint}</div>
          ) : null}
        </div>
        {props.icon ? <DashIcon d={props.icon} tone={props.tone} /> : null}
      </div>
    </>
  );
  const cls =
    "block rounded-2xl border border-zinc-200 bg-white p-5 shadow-soft motion-safe:transition-all motion-safe:duration-200";
  if (props.href) {
    return (
      <Link
        href={props.href as never}
        className={`${cls} hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** Carte de section / graphique : titre, sous-titre période, action optionnelle. */
export function DashCard(props: {
  title: string;
  sub?: string;
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-soft sm:p-6 ${props.className ?? ""}`}
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            {props.title}
          </h2>
          {props.sub ? (
            <p className="mt-0.5 text-xs text-zinc-500">{props.sub}</p>
          ) : null}
        </div>
        {props.action ? (
          <Link
            href={props.action.href as never}
            className="text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
          >
            {props.action.label} →
          </Link>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

const BADGE_TONES: Record<string, string> = {
  brand: "bg-brand-100 text-brand-800",
  green: "bg-mint text-emerald-800",
  amber: "bg-butter text-amber-800",
  red: "bg-red-100 text-red-700",
  zinc: "bg-zinc-100 text-zinc-600",
};

/** Badge de statut cohérent. */
export function StatusBadge(props: {
  label: string;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${BADGE_TONES[props.tone ?? "zinc"]}`}
    >
      {props.label}
    </span>
  );
}

/** État vide soigné (icône + message). */
export function EmptyState(props: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-8 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-7 w-7 text-zinc-300"
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" />
      </svg>
      <p className="text-sm text-zinc-500">{props.message}</p>
      {props.hint ? <p className="text-xs text-zinc-400">{props.hint}</p> : null}
    </div>
  );
}
