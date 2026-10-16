"use client";

import { useFormStatus } from "react-dom";

/**
 * Bouton de soumission partagé : désactivé pendant l'envoi du formulaire
 * parent (`useFormStatus`), libellé « En cours… » exposé aux technologies
 * d'assistance via `aria-busy`. À placer à l'intérieur d'un <form>.
 *
 * Ne remplace PAS l'idempotence côté serveur — simple garde-fou UX.
 */
export function SubmitButton({
  children,
  pendingLabel = "En cours…",
  className = "",
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  /** Libellé affiché pendant la soumission. */
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
