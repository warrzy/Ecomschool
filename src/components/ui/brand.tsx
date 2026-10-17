/**
 * Marque ECOM-SCHOOL — mortier de diplômé stylisé aux couleurs de la plateforme.
 * `variant` : "light" (texte encre, fond clair) ou "dark" (texte blanc, fond bleu nuit).
 * Aucune image externe : SVG vectoriel, net à toutes les tailles.
 */
export function LogoMark(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={props.className ?? "h-8 w-8"}
    >
      {/* Calotte du mortier — bleu profond, légèrement inclinée vers l'avenir. */}
      <path
        d="M24 6 45 16.5 24 27 3 16.5 24 6Z"
        fill="var(--color-brand-500, #2f5fe6)"
      />
      <path
        d="M24 6 45 16.5 24 27 3 16.5 24 6Z"
        fill="rgb(255 255 255 / 0.16)"
        transform="translate(0 -1.2)"
      />
      {/* Bandeau — vert progression. */}
      <path
        d="M13 21.5v7.6c0 4 4.9 7.2 11 7.2s11-3.2 11-7.2v-7.6l-11 5-11-5Z"
        fill="var(--color-leaf-500, #2da265)"
      />
      {/* Pendeloque — jaune doré, point de lumière. */}
      <path
        d="M41 18.2v10.3"
        stroke="var(--color-sun-400, #f5b92e)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle
        cx="41"
        cy="32"
        r="3.2"
        fill="var(--color-sun-400, #f5b92e)"
      />
    </svg>
  );
}

/** Marque complète : symbole + nom. `dark` pour les fonds bleu nuit. */
export function Logo(props: {
  variant?: "light" | "dark";
  className?: string;
  markClassName?: string;
}) {
  const dark = props.variant === "dark";
  return (
    <span className={`inline-flex items-center gap-2.5 ${props.className ?? ""}`}>
      <LogoMark className={props.markClassName ?? "h-8 w-8"} />
      <span
        className={`whitespace-nowrap text-base font-bold tracking-tight ${
          dark ? "text-white" : "text-ink"
        }`}
        style={{ fontFamily: "var(--font-bricolage), var(--font-geist-sans), sans-serif" }}
      >
        E-Com{" "}
        <span className={dark ? "text-sun-400" : "text-brand-500"}>School</span>
      </span>
    </span>
  );
}
