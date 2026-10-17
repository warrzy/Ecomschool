import type { CSSProperties } from "react";

/**
 * Signature graphique ECOM-SCHOOL — éléments vectoriels originaux inspirés
 * de l'apprentissage : étincelles, trait de progression, courbes organiques,
 * avion de papier. Tous server-safe, animés via les classes CSS de globals.
 */

/** Étoile à 4 branches — ponctuation lumineuse (couleur via text-* ou prop). */
export function Sparkle(props: {
  className?: string;
  color?: string;
  twinkle?: boolean;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={props.color ?? "currentColor"}
      aria-hidden="true"
      className={`${props.twinkle !== false ? "twinkle" : ""} ${props.className ?? "h-4 w-4"}`}
      style={props.style}
    >
      <path d="M12 2c.7 5.3 3 8.4 10 10-7 1.6-9.3 4.7-10 10-.7-5.3-3-8.4-10-10 7-1.6 9.3-4.7 10-10Z" />
    </svg>
  );
}

/**
 * Trait de progression — courbe en S qui se dessine à l'apparition
 * (imbriquer dans un <Reveal/> ou poser .is-drawn). Signature réutilisable
 * pour relier des étapes ou souligner des transitions de section.
 */
export function Trail(props: {
  className?: string;
  color?: string;
  dashed?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 200 60"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
      className={props.className ?? "h-10 w-full"}
    >
      <path
        d="M2 48 C 50 10, 90 10, 110 30 S 170 52, 198 20"
        stroke={props.color ?? "var(--color-brand-400, #4f7ef0)"}
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        className={props.dashed ? undefined : "trail-path"}
        strokeDasharray={props.dashed ? "0.06 0.05" : undefined}
      />
    </svg>
  );
}

/** Boucle soulignant un mot dans un titre (ex. « simplicité »). */
export function Scribble(props: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 120 14"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
      className={props.className ?? "h-3 w-full"}
    >
      <path
        d="M3 9 C 35 3, 85 3, 117 8 C 85 12, 40 12, 8 10"
        stroke={props.color ?? "var(--color-sun-400, #f5b92e)"}
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
        className="trail-path"
      />
    </svg>
  );
}

/** Bandeau organique en arc — socle visuel sous les visuels (photos, cadres). */
export function ArcBand(props: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 200 60"
      fill={props.color ?? "var(--color-butter, #fdf4da)"}
      aria-hidden="true"
      preserveAspectRatio="none"
      className={props.className ?? "h-full w-full"}
    >
      <path d="M0 60 C 20 12, 70 0, 100 0 C 140 0, 185 18, 200 60 Z" />
    </svg>
  );
}

/** Avion de papier — clin d'œil au parcours qui décolle. */
export function PaperPlane(props: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className ?? "h-5 w-5"}
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
